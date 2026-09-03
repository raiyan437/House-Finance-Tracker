"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Banknote, Check, CreditCard, Loader2, Paperclip, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";

import {
  prepareExpenseDraft,
  previewExpenseDraft,
  type ExpenseFormDraft,
} from "@/application/expenses/expense-form";
import {
  expenseFormSchema,
  type ExpenseFormValues,
} from "@/application/validation/expense-form.schema";
import type {
  ExpenseMemberView,
  ReceiptView,
  ExpenseView,
} from "@/application/services/application-services";
import { ApplicationError, ReceiptSagaPartialSuccessError } from "@/application/errors/application-error";
import { MAX_AVAILABLE_RECEIPTS_PER_EXPENSE, RECEIPT_USER_QUOTA_BYTES } from "@/application/receipts/receipt-storage-policy";
import type { MyCardSummaryView } from "@/application/cards/card-page";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCanonicalBdt, poisha } from "@/domain/money/poisha";
import { DomainError } from "@/domain/shared/domain-error";
import { expenseDateWindowForBusinessDate } from "@/domain/dates/business-calendar";
import { expenseDate } from "@/domain/dates/expense-date";
import { commandId, expenseId as parseExpenseId, receiptId as parseReceiptId } from "@/domain/shared/identifiers";
import { userErrorMessage } from "@/presentation/errors/user-error-message";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { ErrorState } from "@/presentation/components/async-state";
import { Surface } from "@/presentation/components/surface";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { CapabilityNotice, useCapability } from "@/presentation/runtime/capability-gate.client";
import { useIdempotentCommand } from "@/presentation/runtime/use-idempotent-command";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import {
  formatBasisPoints,
  formatReceiptCreatedAt,
  receiptContentStateText,
  RECEIPT_RETENTION_NOTICE,
} from "./expense-ui";
import { createTrackedReceiptPreviewUrl } from "./receipt-preview-url";
import { EXPENSE_ICON_OPTIONS } from "./expense-icon";

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

interface PendingReceipt {
  readonly key: string;
  readonly file: File;
  readonly url: string;
}

interface ExistingReceiptPreview {
  readonly metadata: ReceiptView;
  readonly url?: string;
  readonly error?: boolean;
  readonly contentPending?: boolean;
}

function definedTextRecord(
  values: Readonly<Record<string, string | undefined>> | undefined,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

const emptyValues: ExpenseFormValues = {
  name: "",
  iconCategory: "others",
  amountText: "",
  expenseDateText: "",
  paymentMethod: "cash",
  selectedCardId: "",
  participantIds: [],
  splitMethod: "equal",
  amountTextByParticipant: {},
  percentageTextByParticipant: {},
};

function editFormValues(
  view: ExpenseView,
  name = view.expense.name,
): ExpenseFormValues {
  return {
    name,
    iconCategory: view.expense.iconCategory ?? "others",
    amountText: formatCanonicalBdt(view.expense.amount),
    expenseDateText: view.expense.expenseDate,
    paymentMethod: view.expense.payment.method,
    selectedCardId: view.privateCardSnapshot?.cardId ?? "",
    participantIds: view.expense.allocations.map(
      (allocation) => allocation.participantId,
    ),
    splitMethod: view.expense.splitMethod,
    amountTextByParticipant: Object.fromEntries(
      view.expense.allocations.map((allocation) => [
        allocation.participantId,
        formatCanonicalBdt(allocation.share),
      ]),
    ),
    percentageTextByParticipant: Object.fromEntries(
      (view.expense.percentageEntries ?? []).map((entry) => [
        entry.participantId,
        formatBasisPoints(entry.basisPoints),
      ]),
    ),
  };
}

interface ExpenseFormPageClientProps {
  readonly mode: "create" | "edit";
  readonly expenseId?: string;
}

export function ExpenseFormPageClient({ mode, expenseId }: ExpenseFormPageClientProps) {
  const runtime = useApplicationRuntime();
  const expenseCommand = useIdempotentCommand();
  const router = useRouter();
  const [members, setMembers] = useState<readonly ExpenseMemberView[]>([]);
  const [cards, setCards] = useState<readonly MyCardSummaryView[]>([]);
  const [original, setOriginal] = useState<ExpenseView>();
  const [existingReceipts, setExistingReceipts] = useState<readonly ExistingReceiptPreview[]>([]);
  const [removedReceiptIds, setRemovedReceiptIds] = useState<readonly string[]>([]);
  const receiptRemovalCommandIds = useRef(new Map<string, ReturnType<typeof commandId>>());
  const [pendingReceipts, setPendingReceipts] = useState<readonly PendingReceipt[]>([]);
  const [receiptError, setReceiptError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadTick, setLoadTick] = useState(0);
  const [confirmCardToCash, setConfirmCardToCash] = useState(false);
  const [businessDate, setBusinessDate] = useState("");
  const [uploaderAvailableReceiptBytes, setUploaderAvailableReceiptBytes] = useState(0);
  const [backdatedConfirmationToken, setBackdatedConfirmationToken] = useState<string>();
  const existingUrlsRef = useRef<{ receiptId: string; url: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const submitErrorRef = useRef<HTMLDivElement>(null);
  const pendingReceiptsRef = useRef<readonly PendingReceipt[]>([]);
  const loadVersionRef = useRef(0);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: emptyValues,
  });
  const values = useWatch({ control: form.control });
  const earliestExpenseDate = businessDate
    ? expenseDateWindowForBusinessDate(expenseDate(businessDate)).earliestAllowedDate
    : undefined;

  const household = runtime.status === "ready" &&
    (runtime.household.status === "active-member" || runtime.household.status === "active-leader")
    ? runtime.household.household
    : undefined;

  const load = useCallback(async () => {
    if (runtime.status !== "ready" || !household) return;
    const loadVersion = ++loadVersionRef.current;
    const isCurrent = () => loadVersionRef.current === loadVersion;
    const [nextMembers, nextCards, nextBusinessDate, nextUploaderAvailableReceiptBytes] = await Promise.all([
      runtime.expenseActions.listMembers(household.householdId),
      runtime.expenseActions.listSelectableCards(),
      runtime.expenseActions.getCurrentBusinessDate(),
      runtime.expenseActions.getMyAvailableReceiptBytes(),
    ]);
    if (!isCurrent()) return;
    setMembers(nextMembers);
    setCards(nextCards);
    setBusinessDate(nextBusinessDate);
    setUploaderAvailableReceiptBytes(nextUploaderAvailableReceiptBytes);

    if (mode === "create") {
      form.reset({
        ...emptyValues,
        expenseDateText: nextBusinessDate,
        participantIds: nextMembers
          .filter((member) => member.status === "active")
          .map((member) => member.userId),
      });
      setLoading(false);
      return;
    }

    const id = parseExpenseId(expenseId ?? "");
    const [view, receipts] = await Promise.all([
      runtime.expenseActions.getExpense(id),
      runtime.expenseActions.listReceipts(id),
    ]);
    if (!isCurrent()) return;
    setOriginal(view);
    existingUrlsRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
    existingUrlsRef.current = [];
    const contentReadsEnabled = runtime.capabilities.receiptContentReads;
    const receiptPreviews = await Promise.all(receipts.map(async (metadata): Promise<ExistingReceiptPreview | undefined> => {
      if (metadata.visibility === "attachment") {
        return { metadata };
      }
      if (!contentReadsEnabled) {
        return {
          metadata,
          ...(metadata.canRead && metadata.contentStatus === "available" ? { contentPending: true } : {}),
        };
      }
      if (!metadata.canRead || metadata.contentStatus !== "available") {
        return { metadata };
      }
      try {
        const url = await createTrackedReceiptPreviewUrl(
          () => runtime.expenseActions.readReceipt(metadata.receiptId),
          isCurrent,
          (nextUrl) => existingUrlsRef.current.push({ receiptId: metadata.receiptId, url: nextUrl }),
        );
        return url ? { metadata, url } : undefined;
      } catch {
        return isCurrent() ? { metadata, error: true } : undefined;
      }
    }));
    const completeReceiptPreviews = receiptPreviews.filter(
      (receipt): receipt is ExistingReceiptPreview => receipt !== undefined,
    );
    if (!isCurrent() || completeReceiptPreviews.length !== receiptPreviews.length) return;
    setExistingReceipts(completeReceiptPreviews);
    form.reset(editFormValues(view));
    setLoading(false);
  }, [expenseId, form, household, mode, runtime]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load().catch(() => {
        setLoadFailed(true);
        setLoading(false);
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load, loadTick]);

  useEffect(() => () => {
    loadVersionRef.current += 1;
    existingUrlsRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
    existingUrlsRef.current = [];
    pendingReceiptsRef.current.forEach((receipt) => URL.revokeObjectURL(receipt.url));
  }, []);

  function stageExistingReceiptRemoval(receiptId: string) {
    if (!receiptRemovalCommandIds.current.has(receiptId)) {
      receiptRemovalCommandIds.current.set(receiptId, commandId(crypto.randomUUID()));
    }
    setRemovedReceiptIds((current) => (current.includes(receiptId) ? current : [...current, receiptId]));
    const entry = existingUrlsRef.current.find((candidate) => candidate.receiptId === receiptId);
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    existingUrlsRef.current = existingUrlsRef.current.filter((candidate) => candidate !== entry);
  }

  const draft: ExpenseFormDraft = useMemo(() => ({
    name: values.name ?? "",
    iconCategory: values.iconCategory ?? "others",
    amountText: values.amountText ?? "",
    expenseDateText: values.expenseDateText ?? "",
    paymentMethod: values.paymentMethod ?? "cash",
    selectedCardId: values.selectedCardId || undefined,
    participantIds: values.participantIds ?? [],
    splitMethod: values.splitMethod ?? "equal",
    amountTextByParticipant: definedTextRecord(values.amountTextByParticipant),
    percentageTextByParticipant: definedTextRecord(values.percentageTextByParticipant),
  }), [values]);
  const currentUserId = runtime.status === "ready" ? runtime.session.userId : undefined;
  const preview = useMemo(
    () => previewExpenseDraft(draft, currentUserId),
    [currentUserId, draft],
  );
  const memberById = useMemo(() => new Map<string, ExpenseMemberView>(members.map((member) => [member.userId, member])), [members]);
  const financialLocked = original?.financialEditability.state === "locked";
  const expenseMutationsEnabled = useCapability("expenseMutations");
  const receiptMutationsEnabled = useCapability("receiptMutations");
  const saveDisabled = !expenseMutationsEnabled;
  const ownerEditing = original?.expense.creatorId === currentUserId;
  const payerName = original
    ? original.expense.creatorId === currentUserId
      ? "You"
      : memberById.get(original.expense.creatorId)?.displayName ?? "Household member"
    : "You";

  const fieldWasInteractedWith = (
    field: "name" | "amountText" | "expenseDateText" | "participantIds" | "splitMethod",
  ) => attemptedSubmit || Boolean(
    form.formState.dirtyFields[field] || form.formState.touchedFields[field],
  );
  const splitEntryWasInteractedWith = (method: "amount" | "percentage", id: string) => {
    const dirty = form.formState.dirtyFields[
      method === "amount" ? "amountTextByParticipant" : "percentageTextByParticipant"
    ];
    const touched = form.formState.touchedFields[
      method === "amount" ? "amountTextByParticipant" : "percentageTextByParticipant"
    ];
    return attemptedSubmit || Boolean(
      dirty && typeof dirty === "object" && dirty[id]
      || touched && typeof touched === "object" && touched[id],
    );
  };
  const splitWasInteractedWith = attemptedSubmit
    || fieldWasInteractedWith("splitMethod")
    || draft.participantIds.some((id) => splitEntryWasInteractedWith(draft.splitMethod === "percentage" ? "percentage" : "amount", id));
  const nameIssue = fieldWasInteractedWith("name")
    ? form.formState.errors.name?.message ?? preview.issues.name
    : undefined;
  const amountIssue = fieldWasInteractedWith("amountText") ? preview.issues.amountText : undefined;
  const dateIssue = fieldWasInteractedWith("expenseDateText") ? preview.issues.expenseDateText : undefined;
  const participantsIssue = fieldWasInteractedWith("participantIds") ? preview.issues.participants : undefined;
  const splitIssue = splitWasInteractedWith ? preview.issues.split : undefined;

  function focusFirstInvalidField() {
    window.requestAnimationFrame(() => {
      if (preview.issues.name) {
        form.setFocus("name");
        return;
      }
      if (preview.issues.amountText) {
        form.setFocus("amountText");
        return;
      }
      if (preview.issues.expenseDateText) {
        document.getElementById("expense-date")?.focus();
        return;
      }
      if (preview.issues.participants) {
        document.querySelector<HTMLInputElement>("#expense-participants input")?.focus();
        return;
      }
      const splitEntry = draft.participantIds.find((id) =>
        preview.issues[`${draft.splitMethod}:${id}`],
      );
      if (splitEntry) {
        document.getElementById(`expense-${draft.splitMethod}-share-${splitEntry}`)?.focus();
        return;
      }
      if (preview.issues.split) {
        document.querySelector<HTMLInputElement>("#expense-split-method input")?.focus();
      }
    });
  }

  function revealErrorsAndFocus() {
    setAttemptedSubmit(true);
    focusFirstInvalidField();
  }

  function toggleParticipant(id: string, checked: boolean) {
    const current = form.getValues("participantIds");
    form.setValue(
      "participantIds",
      checked ? [...current, id] : current.filter((value) => value !== id),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function addReceiptFiles(files: FileList | null) {
    if (!files) return;
    const accepted: PendingReceipt[] = [];
    const availableExistingCount = existingReceipts.filter(({ metadata }) => metadata.visibility === "private" && metadata.contentStatus === "available" && !removedReceiptIds.includes(metadata.receiptId)).length;
    for (const file of Array.from(files)) {
      if (availableExistingCount + pendingReceipts.length + accepted.length >= MAX_AVAILABLE_RECEIPTS_PER_EXPENSE) {
        setReceiptError("An Expense can have at most three available receipts.");
        break;
      }
      if (!RECEIPT_TYPES.includes(file.type)) {
        setReceiptError("Receipts must be JPEG, PNG, or WebP images.");
        continue;
      }
      if (file.size < 1 || file.size > MAX_RECEIPT_BYTES) {
        setReceiptError("Each receipt must be from 1 byte through 10 MiB.");
        continue;
      }
      accepted.push({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    if (accepted.length) {
      setReceiptError(undefined);
      pendingReceiptsRef.current = [...pendingReceiptsRef.current, ...accepted];
      setPendingReceipts(pendingReceiptsRef.current);
    }
  }

  function removePendingReceipt(key: string) {
    const target = pendingReceiptsRef.current.find((receipt) => receipt.key === key);
    if (!target) return;
    URL.revokeObjectURL(target.url);
    pendingReceiptsRef.current = pendingReceiptsRef.current.filter((receipt) => receipt.key !== key);
    setPendingReceipts(pendingReceiptsRef.current);
  }

  async function doSaveExpense(confirmationToken?: string) {
    if (runtime.status !== "ready" || !household) return;
    setAttemptedSubmit(true);
    setSubmitError(undefined);
    setReceiptError(undefined);
    if (!financialLocked && !preview.canPersist) {
      focusFirstInvalidField();
      return;
    }
    try {
      const prepared = financialLocked && original
        ? {
            name: form.getValues("name").trim(),
            iconCategory: form.getValues("iconCategory"),
            amount: original.expense.amount,
            expenseDate: original.expense.expenseDate,
            splitMethod: original.expense.splitMethod,
            percentageEntries: original.expense.percentageEntries,
            allocations: original.expense.allocations,
          }
        : prepareExpenseDraft(draft, currentUserId);
      const newReceipts = [];
      for (const receipt of pendingReceipts) {
        newReceipts.push({
          commandId: commandId(receipt.key),
          originalFilename: receipt.file.name,
          content: {
            bytes: new Uint8Array(await receipt.file.arrayBuffer()),
            mimeType: receipt.file.type as "image/jpeg" | "image/png" | "image/webp",
          },
        });
      }

      if (mode === "create") {
        if (draft.paymentMethod === "card" && !draft.selectedCardId) {
          setSubmitError("Select a Card or use Cash.");
          return;
        }
        const selectedCard = cards.find((card) => card.cardId === draft.selectedCardId);
        if (draft.paymentMethod === "card" && !selectedCard) {
          setSubmitError("Select an available Card.");
          return;
        }
        const intentKey = JSON.stringify({ mode, draft, receiptKeys: pendingReceipts.map((item) => item.key) });
        const created = await runtime.expenseActions.createExpense({
          commandId: expenseCommand.forIntent(intentKey),
          ...(confirmationToken ? { backdatedConfirmationToken: confirmationToken } : {}),
          householdId: household.householdId,
          name: prepared.name,
          iconCategory: prepared.iconCategory,
          amount: prepared.amount,
          expenseDate: prepared.expenseDate,
          splitMethod: prepared.splitMethod,
          percentageEntries: prepared.percentageEntries,
          allocations: prepared.allocations,
          payment: draft.paymentMethod === "cash"
            ? { method: "cash" }
            : { method: "card", cardId: selectedCard!.cardId },
          receipts: newReceipts,
        });
        expenseCommand.complete();
        setBackdatedConfirmationToken(undefined);
        router.push(`/expenses/${created.expense.expenseId}`);
        return;
      }

      if (!original) return;
      let payment: Parameters<typeof runtime.expenseActions.editExpense>[0]["payment"];
      if (draft.paymentMethod === original.expense.payment.method) {
        if (draft.paymentMethod === "card" && ownerEditing && draft.selectedCardId && draft.selectedCardId !== original.privateCardSnapshot?.cardId) {
          payment = { kind: "card", cardId: cards.find((card) => card.cardId === draft.selectedCardId)!.cardId };
        } else {
          payment = { kind: "preserve" };
        }
      } else if (draft.paymentMethod === "cash") {
        if (!confirmCardToCash) {
          setSubmitError("Confirm the change from Card to Cash before saving.");
          return;
        }
        payment = { kind: "cash", confirmedPrivateReferenceDetachment: true };
      } else {
        const card = cards.find((item) => item.cardId === draft.selectedCardId);
        if (!card) {
          setSubmitError("Select an available Card.");
          return;
        }
        payment = { kind: "card", cardId: card.cardId };
      }
      const intentKey = JSON.stringify({ mode, expenseId: original.expense.expenseId, revision: original.expense.revision, draft, receiptKeys: pendingReceipts.map((item) => item.key), removedReceiptIds });
      await runtime.expenseActions.editExpense({
        commandId: expenseCommand.forIntent(intentKey),
        ...(confirmationToken ? { backdatedConfirmationToken: confirmationToken } : {}),
        expenseId: original.expense.expenseId,
        expectedRevision: original.expense.revision,
        name: prepared.name,
        iconCategory: prepared.iconCategory,
        amount: prepared.amount,
        expenseDate: prepared.expenseDate,
        splitMethod: prepared.splitMethod,
        percentageEntries: prepared.percentageEntries,
        allocations: prepared.allocations,
        payment,
        newReceipts,
        removedReceiptIds: removedReceiptIds.map(parseReceiptId),
        receiptRemovalCommandIds: Object.fromEntries(
          removedReceiptIds.map((id) => [id, receiptRemovalCommandIds.current.get(id) ?? commandId(crypto.randomUUID())]),
        ),
      });
      expenseCommand.complete();
      setBackdatedConfirmationToken(undefined);
      router.push(`/expenses/${original.expense.expenseId}`);
    } catch (error) {
      if (error instanceof ReceiptSagaPartialSuccessError) {
        if (mode === "edit" && original) {
          try {
            const refreshed = await runtime.expenseActions.getExpense(parseExpenseId(error.savedExpenseId));
            setOriginal(refreshed);
            form.reset(editFormValues(refreshed, form.getValues("name")));
          } catch {
            // The explicit partial-success message remains accurate even if refresh is temporarily unavailable.
          }
        }
        setSubmitError(error.message);
        return;
      }
      if (error instanceof ApplicationError && error.code === "BACKDATED_EXPENSE_CONFIRMATION_REQUIRED") {
        const token = "confirmationToken" in error
          ? String(error.confirmationToken)
          : undefined;
        if (token) {
          setBackdatedConfirmationToken(token);
          return;
        }
      }
      if (error instanceof ApplicationError && error.code === "EXPENSE_VERSION_CONFLICT" && original) {
        try {
          const refreshed = await runtime.expenseActions.getExpense(original.expense.expenseId);
          const nameDraft = form.getValues("name");
          setOriginal(refreshed);
          form.reset(editFormValues(refreshed, nameDraft));
          expenseCommand.complete();
          setBackdatedConfirmationToken(undefined);
          setSubmitError("This expense changed while you were editing it. Refresh and review the latest version before saving.");
          return;
        } catch {
          setSubmitError("This expense changed while you were editing it. Refresh and review the latest version before saving.");
          return;
        }
      }
      if (
        error instanceof DomainError &&
        error.code === "EXPENSE_FINANCIAL_HISTORY_LOCKED" &&
        original
      ) {
        try {
          const refreshed = await runtime.expenseActions.getExpense(
            original.expense.expenseId,
          );
          const nameDraft = form.getValues("name");
          setOriginal(refreshed);
          form.reset(editFormValues(refreshed, nameDraft));
          setConfirmCardToCash(false);
          setSubmitError(
            "Financial details are now locked. Your financial changes were not saved; your Expense Name and receipt draft work were preserved.",
          );
          return;
        } catch {
          setSubmitError(
            "Financial details are now locked. Reload the expense before trying again.",
          );
          return;
        }
      }
      setSubmitError(userErrorMessage(error, "The expense could not be saved."));
    }
  }

  const pendingSave = saving || form.formState.isSubmitting;
  useEffect(() => {
    if (submitError) submitErrorRef.current?.focus();
  }, [submitError]);

  async function saveExpense(confirmationToken?: string) {
    if (saving) return;
    setSaving(true);
    try {
      await doSaveExpense(confirmationToken);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <PageContainer><Surface><p role="status">Loading expense form…</p></Surface></PageContainer>;
  }
  if (loadFailed) {
    return (
      <PageContainer>
        <ErrorState
          description="The expense could not be loaded. Your saved financial data was not changed."
          onRetry={() => { setLoadFailed(false); setLoading(true); setLoadTick((value) => value + 1); }}
          title="Expense form unavailable"
        />
      </PageContainer>
    );
  }
  if (original?.financialEditability.state === "deleted") {
    return <PageContainer><Surface><div role="status" className="p-4"><p className="font-semibold text-danger">This deleted expense is read-only.</p><p className="mt-1 text-sm text-text-secondary">Deleted expenses remain as read-only household history and can no longer be edited or deleted again.</p></div></Surface></PageContainer>;
  }

  const allocationStatus = preview.remaining !== undefined
    ? preview.remaining < 0
      ? `Over by ${formatBdt(poisha(-preview.remaining))}`
      : `Remaining ${formatBdt(preview.remaining)}`
    : "Complete the expense details";
  const availableExistingReceipts = existingReceipts.filter(({ metadata }) => metadata.visibility === "private" && metadata.contentStatus === "available" && !removedReceiptIds.includes(metadata.receiptId));
  const availableReceiptCount = availableExistingReceipts.length + pendingReceipts.length;
  const releasedReceiptBytes = existingReceipts.reduce((total, item) => total + (item.metadata.visibility === "private" && item.metadata.contentStatus === "available" && removedReceiptIds.includes(item.metadata.receiptId) ? item.metadata.sizeBytes : 0), 0);
  const pendingReceiptBytes = pendingReceipts.reduce((total, item) => total + item.file.size, 0);
  const remainingUploaderReceiptBytes = Math.max(0, RECEIPT_USER_QUOTA_BYTES - uploaderAvailableReceiptBytes + releasedReceiptBytes - pendingReceiptBytes);

  return (
    <PageContainer>
      <Button asChild variant="ghost" className="-ml-3 min-h-11 rounded-xl lg:min-h-9"><Link href={original ? `/expenses/${original.expense.expenseId}` : "/expenses"}><ArrowLeft /> Back to expenses</Link></Button>
      <PageHeader className="mt-[14px]" title={mode === "create" ? "Add Expense" : "Edit Expense"} description={mode === "create" ? "Record what you paid and allocate every poisha exactly." : "Payer and creator remain fixed; permitted changes recalculate from source history."} />
      {financialLocked ? <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-foreground" role="status"><p className="font-semibold">{original?.financialEditability.title}</p><p className="mt-1">{original?.financialEditability.description}</p><p className="mt-1 text-text-secondary">Expense Name and receipts may still be updated.</p></div> : null}

      <AlertDialog open={Boolean(backdatedConfirmationToken)} onOpenChange={(open) => { if (!open) { setBackdatedConfirmationToken(undefined); expenseCommand.complete(); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Expense dated before a confirmed settlement</AlertDialogTitle><AlertDialogDescription>This expense is dated before a household settlement that was already confirmed. Adding it may create new outstanding balances even though earlier balances were previously settled.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); if (saving) return; const token = backdatedConfirmationToken; if (token) void saveExpense(token); }}>{saving ? "Saving…" : mode === "create" ? "Add Expense" : "Save Changes"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <form className="expense-form-grid mt-7 grid gap-6" onSubmit={form.handleSubmit(() => saveExpense(), revealErrorsAndFocus)} noValidate>
        <div className="grid content-start gap-4">
          <Surface className="expense-details-panel order-1 space-y-3" padding="canonical">
            <h2 className="panel-title">Expense Details</h2>
            <div className="expense-details-fields grid gap-3 sm:grid-cols-2">
              <div className="expense-name-field space-y-2 sm:col-span-2"><Label htmlFor="expense-name">Expense Name</Label><Input id="expense-name" aria-invalid={Boolean(nameIssue)} aria-describedby={nameIssue ? "expense-name-error" : undefined} {...form.register("name")} />{nameIssue ? <p id="expense-name-error" className="text-caption text-danger">{nameIssue}</p> : null}</div>
              <fieldset className="sm:col-span-2">
                <legend className="text-label font-medium">Expense Category</legend>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {EXPENSE_ICON_OPTIONS.map(({ value, label, Icon }) => {
                    const selected = values.iconCategory === value;
                    return <label key={value} className={`relative flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-xs font-medium transition-colors focus-within:ring-3 focus-within:ring-ring/30 ${selected ? "border-foreground bg-brand-soft" : "bg-card hover:bg-secondary"}`}><input className="absolute inset-0 size-full cursor-pointer opacity-0" type="radio" value={value} {...form.register("iconCategory")} /><Icon aria-hidden="true" className="size-5" /><span>{label}</span></label>;
                  })}
                </div>
              </fieldset>
              <div className="space-y-2"><Label htmlFor="expense-amount">Amount (BDT)</Label><Input id="expense-amount" inputMode="decimal" disabled={financialLocked} aria-invalid={Boolean(amountIssue)} aria-describedby={amountIssue ? "expense-amount-error" : undefined} {...form.register("amountText")} />{amountIssue ? <p id="expense-amount-error" className="text-caption text-danger">{amountIssue}</p> : null}</div>
               <div className="space-y-2"><Label htmlFor="expense-date">Expense Date</Label><DatePicker id="expense-date" disabled={financialLocked} min={earliestExpenseDate} max={businessDate || undefined} invalid={Boolean(dateIssue)} aria-describedby={dateIssue ? "expense-date-error" : undefined} value={values.expenseDateText} onChange={(value) => form.setValue("expenseDateText", value, { shouldDirty: true, shouldTouch: true, shouldValidate: true })} />{dateIssue ? <p id="expense-date-error" className="text-caption text-danger">{dateIssue}</p> : null}</div>
              <div className="space-y-2"><Label>Paid By</Label><div className="flex h-11 items-center rounded-md border bg-secondary px-3 text-sm">{payerName}</div></div>
            </div>
            <fieldset disabled={financialLocked || (Boolean(original) && !ownerEditing && original?.expense.payment.method === "cash")}>
              <legend className="text-label font-medium">Payment Method</legend>
              <div className="mt-2 grid grid-cols-2 rounded-xl bg-secondary p-1">
                {(["cash", "card"] as const).map((method) => <label key={method} className={`relative flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-medium focus-within:ring-3 focus-within:ring-ring/30 ${draft.paymentMethod === method ? "bg-card shadow-[var(--shadow-small)]" : "text-text-secondary"}`}><input className="absolute inset-0 z-10 size-full cursor-pointer opacity-0" type="radio" value={method} {...form.register("paymentMethod")} />{method === "cash" ? <Banknote aria-hidden="true" className="size-4" /> : <CreditCard aria-hidden="true" className="size-4" />}<span className="capitalize">{method}</span></label>)}
              </div>
            </fieldset>
            {draft.paymentMethod === "card" ? (
              ownerEditing || mode === "create" ? <div className="space-y-2"><Label htmlFor="expense-card">Your Card</Label><Select disabled={financialLocked || (cards.length === 0 && !original?.privateCardSnapshot)} value={values.selectedCardId || undefined} onValueChange={(value) => form.setValue("selectedCardId", value, { shouldDirty: true, shouldTouch: true, shouldValidate: true })}><SelectTrigger id="expense-card" aria-label="Your Card"><SelectValue placeholder={cards.length ? "Select a Card" : "No cards available"} /></SelectTrigger><SelectContent align="start">{original?.privateCardSnapshot && !cards.some((card) => card.cardId === original.privateCardSnapshot?.cardId) ? <SelectItem value={original.privateCardSnapshot.cardId}>Keep {original.privateCardSnapshot.cardName} (archived)</SelectItem> : null}{cards.map((card) => <SelectItem key={card.cardId} value={card.cardId}>{card.name} · {card.type === "debit" ? "Debit" : "Credit"}</SelectItem>)}</SelectContent></Select>{cards.length === 0 && !original?.privateCardSnapshot ? <p className="text-sm text-text-secondary">No cards available. <Link className="font-medium text-foreground underline underline-offset-4" href="/cards">Add a private Card label in My Cards</Link>, or use Cash.</p> : null}</div> : <p className="text-sm text-text-secondary">The existing private Card association will be preserved opaquely.</p>
            ) : null}
            {original?.expense.payment.method === "card" && draft.paymentMethod === "cash" ? <label className="flex min-h-11 items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-3"><input className="mt-1" type="checkbox" checked={confirmCardToCash} onChange={(event) => setConfirmCardToCash(event.target.checked)} /><span>Confirm changing the current Payment Method from Card to Cash.</span></label> : null}
          </Surface>

          <Surface className="split-expense-panel order-3 space-y-3" padding="canonical">
            <h2 className="panel-title">Split Expense</h2>
            <fieldset id="expense-participants" disabled={financialLocked}>
              <legend className="text-label font-medium">Participants</legend>
              <p className="mt-1 text-sm text-text-secondary">Select at least one household member. You may exclude yourself.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {members.filter((member) => member.status === "active" || draft.participantIds.includes(member.userId)).map((member) => { const selected = draft.participantIds.includes(member.userId); return <label key={member.userId} className={`relative flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 focus-within:ring-3 focus-within:ring-ring/30 ${selected ? "border-foreground bg-secondary" : "bg-card"}`}><input className="absolute inset-0 z-10 size-full cursor-pointer opacity-0" type="checkbox" checked={selected} onChange={(event) => toggleParticipant(member.userId, event.target.checked)} /><MemberAvatar className="size-7 [&_[data-slot=avatar-fallback]]:text-[9px]" displayName={member.displayName} userId={member.userId} /><span className="min-w-0 flex-1 truncate text-xs font-medium">{member.userId === currentUserId ? "You" : member.displayName}{member.status === "former" ? " (Former member)" : ""}</span>{selected ? <Check aria-hidden="true" className="size-4" /> : null}</label>; })}
              </div>
              {participantsIssue ? <p className="mt-2 text-sm text-danger" role="alert">{participantsIssue}</p> : null}
            </fieldset>
            <fieldset id="expense-split-method" disabled={financialLocked}>
              <legend className="sr-only">Split Method</legend>
              <div className="grid grid-cols-3 rounded-xl bg-secondary p-1">{(["equal", "amount", "percentage"] as const).map((method) => <label key={method} className={`relative flex h-9 cursor-pointer items-center justify-center rounded-lg text-xs font-medium capitalize focus-within:ring-3 focus-within:ring-ring/30 ${draft.splitMethod === method ? "bg-card shadow-[var(--shadow-small)]" : "text-text-secondary"}`}><input className="absolute inset-0 z-10 size-full cursor-pointer opacity-0" type="radio" value={method} {...form.register("splitMethod")} /> {method}</label>)}</div>
            </fieldset>
            {original?.percentageSourceStatus === "legacy-percentage-input-unavailable" ? <p className="rounded-lg bg-warning-soft p-3 text-sm" role="status">Original percentage inputs are unavailable. No percentages have been inferred from the saved poisha shares.</p> : null}
            <div className="grid gap-2 sm:grid-cols-3">
              {draft.participantIds.map((id) => {
                const member = memberById.get(id);
                const allocation = preview.allocations.find((item) => item.participantId === id);
                const entryIssue = draft.splitMethod === "equal" || !splitEntryWasInteractedWith(draft.splitMethod, id)
                  ? undefined
                  : preview.issues[`${draft.splitMethod}:${id}`];
                const inputId = `expense-${draft.splitMethod}-share-${id}`;
                return <div key={id} className="grid items-center gap-1 rounded-xl border p-3"><span className="truncate text-xs font-medium">{id === currentUserId ? "You" : member?.displayName ?? "Member"}</span>{draft.splitMethod === "amount" ? <Input id={inputId} className="h-9" disabled={financialLocked} inputMode="decimal" aria-label={`Amount share for ${member?.displayName ?? id}`} aria-invalid={Boolean(entryIssue)} aria-describedby={entryIssue ? `${inputId}-error` : undefined} value={draft.amountTextByParticipant[id] ?? ""} onChange={(event) => form.setValue(`amountTextByParticipant.${id}`, event.target.value, { shouldDirty: true })} onBlur={() => form.setValue(`amountTextByParticipant.${id}`, draft.amountTextByParticipant[id] ?? "", { shouldTouch: true, shouldValidate: true })} /> : draft.splitMethod === "percentage" ? <div className="relative"><Input id={inputId} disabled={financialLocked} inputMode="decimal" aria-label={`Percentage share for ${member?.displayName ?? id}`} aria-invalid={Boolean(entryIssue)} aria-describedby={entryIssue ? `${inputId}-error` : undefined} className="h-9 pr-8" value={draft.percentageTextByParticipant[id] ?? ""} onChange={(event) => form.setValue(`percentageTextByParticipant.${id}`, event.target.value, { shouldDirty: true })} onBlur={() => form.setValue(`percentageTextByParticipant.${id}`, draft.percentageTextByParticipant[id] ?? "", { shouldTouch: true, shouldValidate: true })} /><span className="absolute right-3 top-2 text-text-muted">%</span></div> : <span className="text-fine text-text-muted">Calculated equally</span>}<span className="financial-numerals text-xs font-semibold">{allocation ? formatBdt(allocation.share) : "—"}{preview.provisional && draft.splitMethod === "percentage" ? <small className="block text-warning">Provisional</small> : null}</span>{entryIssue ? <p id={`${inputId}-error`} className="text-caption text-danger">{entryIssue}</p> : null}</div>;
              })}
            </div>
            {splitIssue ? <p className="text-sm text-danger" role="alert">{splitIssue}</p> : null}
          </Surface>

          <Surface className="receipts-panel order-2 space-y-3" padding="canonical">
            <div><h2 className="panel-title">Receipts</h2><p className="compact-caption mt-0.5 text-text-muted">Optional JPEG, PNG, or WebP images, up to 10 MiB each.</p>{!original || original.expense.creatorId === currentUserId ? <p className="compact-caption mt-1 text-text-muted">{availableReceiptCount} of {MAX_AVAILABLE_RECEIPTS_PER_EXPENSE} available · {Math.floor(remainingUploaderReceiptBytes / (1024 * 1024))} MiB of your receipt quota remains</p> : null}<p className="compact-caption mt-1 text-text-muted">{RECEIPT_RETENTION_NOTICE}</p></div>
            {!original || original.expense.creatorId === currentUserId ? (<div className="grid gap-1">{receiptMutationsEnabled ? <Label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"><Upload className="size-4" /> Add receipt images<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { addReceiptFiles(event.target.files); event.target.value = ""; }} /></Label> : <div aria-hidden className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm text-text-muted opacity-60" data-capability-pending><Upload className="size-4" /> Add receipt images</div>}<CapabilityNotice active={!receiptMutationsEnabled} /></div>) : <p className="rounded-xl bg-secondary p-3 text-sm text-text-secondary">Receipt details and management are private to the Expense creator.</p>}
            {receiptError ? <p className="text-sm text-danger" role="alert">{receiptError}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {existingReceipts.filter(({ metadata }) => metadata.visibility === "attachment" || !removedReceiptIds.includes(metadata.receiptId)).map(({ metadata, url, error, contentPending }, index) => { if (metadata.visibility === "attachment") return <div key={`private-attachment-${index}`} className="rounded-xl border bg-secondary p-4"><p className="text-sm font-medium">Receipt attached</p><p className="compact-caption mt-1 text-text-muted">Private receipt details are not available to other Household members or Leaders.</p></div>; const historicalState = receiptContentStateText(metadata.contentStatus); return <div key={metadata.receiptId} className="rounded-xl border p-3">{metadata.contentStatus !== "available" ? <div className="flex h-28 flex-col items-center justify-center rounded-lg bg-secondary px-3 text-center"><Paperclip aria-hidden="true" className="mb-1 size-5 text-text-muted" /><p className="text-xs font-medium">{historicalState.title}</p>{historicalState.description ? <p className="compact-caption mt-1 text-text-muted">{historicalState.description}</p> : null}</div> : contentPending ? <div className="flex h-28 flex-col items-center justify-center rounded-lg bg-secondary px-3 text-center"><Paperclip aria-hidden="true" className="mb-1 size-5 text-text-muted" /><p className="text-xs font-medium">Preview arrives with receipt storage in a later update.</p></div> : url ? <span className="relative block h-28 overflow-hidden rounded-lg"><Image className="object-cover" src={url} alt={metadata.originalFilename ?? "Expense receipt"} fill sizes="240px" unoptimized /></span> : <div className="flex h-28 flex-col items-center justify-center rounded-lg bg-secondary px-3 text-center"><Paperclip aria-hidden="true" className="mb-1 size-5 text-text-muted" />{error ? <><p className="text-xs font-medium">Preview unavailable</p><p className="compact-caption mt-1 text-text-muted">The stored image could not be displayed. Your file was not changed.</p></> : <span className="sr-only">Loading receipt preview</span>}</div>}<p className="mt-2 truncate text-sm">{metadata.originalFilename ?? "Receipt image"}</p><p className="compact-caption text-text-muted">Uploaded {formatReceiptCreatedAt(metadata.createdAt)}</p>{metadata.canRemove ? <Button type="button" variant="ghost" size="sm" disabled={!receiptMutationsEnabled} onClick={() => stageExistingReceiptRemoval(metadata.receiptId)}><Trash2 /> Remove</Button> : null}</div>; })}
              {pendingReceipts.map((receipt) => <div key={receipt.key} className="rounded-xl border p-3"><span className="relative block h-28 overflow-hidden rounded-lg"><Image className="object-cover" src={receipt.url} alt={receipt.file.name} fill sizes="240px" unoptimized /></span><p className="mt-2 truncate text-sm">{receipt.file.name}</p><Button type="button" variant="ghost" size="sm" disabled={!receiptMutationsEnabled} onClick={() => removePendingReceipt(receipt.key)}><Trash2 /> Remove</Button></div>)}
            </div>
          </Surface>
        </div>

        <aside aria-label="Expense summary and actions" className="flex self-stretch flex-col gap-4 min-[1400px]:min-h-[808px]">
          <Surface className="min-h-[450px]" elevation="card" padding="canonical">
            <h2 className="panel-title">Summary</h2>
            <dl className="space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-text-secondary">Expense Total</dt><dd className="font-semibold tabular-nums">{preview.amount ? formatBdt(preview.amount) : "—"}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-secondary">Allocated</dt><dd className="tabular-nums">{preview.allocated !== undefined ? formatBdt(preview.allocated) : "—"}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-secondary">Your Share</dt><dd className="tabular-nums">{formatBdt(preview.yourShare)}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-secondary">Participants</dt><dd>{preview.participantCount}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-secondary">Payment Method</dt><dd className="capitalize">{draft.paymentMethod}</dd></div><div className="border-t pt-3"><dt className="text-text-secondary">Allocation Status</dt><dd className={preview.canPersist || financialLocked ? "mt-1 font-medium text-success" : "mt-1 font-medium text-warning"}>{financialLocked ? "Financial history preserved" : allocationStatus}</dd></div></dl>
            {submitError ? <div className="mt-5 rounded-lg bg-danger-soft p-3 text-sm text-danger" role="alert" tabIndex={-1} ref={submitErrorRef}>{submitError}</div> : null}
          </Surface>
          <Surface className="min-h-[104px]" padding="canonical"><div className="flex gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft"><ShieldCheck aria-hidden="true" className="size-4" /></span><div><h2 className="text-sm font-semibold">Privacy Note</h2><p className="compact-caption mt-1 text-text-muted">Private Card details remain visible only to the Card owner.</p></div></div></Surface>
          <div className="mt-auto grid gap-3"><div className="grid grid-cols-[116px_minmax(0,1fr)] gap-3"><Button type="button" variant="outline" asChild><Link href={original ? `/expenses/${original.expense.expenseId}` : "/expenses"}>Cancel</Link></Button><Button aria-busy={pendingSave} disabled={pendingSave || saveDisabled} type="submit">{pendingSave ? <><Loader2 aria-hidden="true" className="size-4 animate-spin" /> Saving…</> : mode === "create" ? "Create Expense" : "Save Changes"}</Button></div><CapabilityNotice active={saveDisabled} /></div>
        </aside>
      </form>
    </PageContainer>
  );
}
