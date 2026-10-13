"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
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
  ExpenseView,
} from "@/application/services/application-services";
import {
  ApplicationError,
  ReceiptSagaPartialSuccessError,
} from "@/application/errors/application-error";
import {
  MAX_AVAILABLE_RECEIPTS_PER_EXPENSE,
  RECEIPT_USER_QUOTA_BYTES,
} from "@/application/receipts/receipt-storage-policy";
import type { MyCardSummaryView } from "@/application/cards/card-page";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { poisha } from "@/domain/money/poisha";
import { DomainError } from "@/domain/shared/domain-error";
import { expenseDateWindowForBusinessDate } from "@/domain/dates/business-calendar";
import { expenseDate } from "@/domain/dates/expense-date";
import {
  commandId,
  expenseId as parseExpenseId,
  receiptId as parseReceiptId,
} from "@/domain/shared/identifiers";
import { userErrorMessage } from "@/presentation/errors/user-error-message";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { ErrorState } from "@/presentation/components/async-state";
import { Surface } from "@/presentation/components/surface";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { useCapability } from "@/presentation/runtime/capability-gate.client";
import { useIdempotentCommand } from "@/presentation/runtime/use-idempotent-command";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { createTrackedReceiptPreviewUrl } from "./receipt-preview-url";
import {
  RECEIPT_TYPES,
  MAX_RECEIPT_BYTES,
  type PendingReceipt,
  type ExistingReceiptPreview,
  definedTextRecord,
  emptyValues,
  editFormValues,
} from "./expense-form-model";
import { ExpenseDetailsSection } from "./expense-details-section.client";
import { ExpenseSplitSection } from "./expense-split-section.client";
import { ExpenseReceiptsSection } from "./expense-receipts-section.client";
import { ExpenseSummarySection } from "./expense-summary-section.client";

interface ExpenseFormPageClientProps {
  readonly mode: "create" | "edit";
  readonly expenseId?: string;
}

export function ExpenseFormPageClient({
  mode,
  expenseId,
}: ExpenseFormPageClientProps) {
  const runtime = useApplicationRuntime();
  const expenseCommand = useIdempotentCommand();
  const router = useRouter();
  const [members, setMembers] = useState<readonly ExpenseMemberView[]>([]);
  const [cards, setCards] = useState<readonly MyCardSummaryView[]>([]);
  const [original, setOriginal] = useState<ExpenseView>();
  const [existingReceipts, setExistingReceipts] = useState<
    readonly ExistingReceiptPreview[]
  >([]);
  const [removedReceiptIds, setRemovedReceiptIds] = useState<readonly string[]>(
    [],
  );
  const receiptRemovalCommandIds = useRef(
    new Map<string, ReturnType<typeof commandId>>(),
  );
  const [pendingReceipts, setPendingReceipts] = useState<
    readonly PendingReceipt[]
  >([]);
  const [receiptError, setReceiptError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadTick, setLoadTick] = useState(0);
  const [confirmCardToCash, setConfirmCardToCash] = useState(false);
  const [businessDate, setBusinessDate] = useState("");
  const [uploaderAvailableReceiptBytes, setUploaderAvailableReceiptBytes] =
    useState(0);
  const [backdatedConfirmationToken, setBackdatedConfirmationToken] =
    useState<string>();
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
    ? expenseDateWindowForBusinessDate(expenseDate(businessDate))
        .earliestAllowedDate
    : undefined;

  const household =
    runtime.status === "ready" &&
    (runtime.household.status === "active-member" ||
      runtime.household.status === "active-leader")
      ? runtime.household.household
      : undefined;

  const load = useCallback(async () => {
    if (runtime.status !== "ready" || !household) return;
    const loadVersion = ++loadVersionRef.current;
    const isCurrent = () => loadVersionRef.current === loadVersion;
    const [
      nextMembers,
      nextCards,
      nextBusinessDate,
      nextUploaderAvailableReceiptBytes,
    ] = await Promise.all([
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
      form.reset(
        {
          ...emptyValues,
          expenseDateText: nextBusinessDate,
          participantIds: nextMembers
            .filter((member) => member.status === "active")
            .map((member) => member.userId),
        },
        { keepDirtyValues: true },
      );
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
    const receiptPreviews = await Promise.all(
      receipts.map(
        async (metadata): Promise<ExistingReceiptPreview | undefined> => {
          if (!contentReadsEnabled) {
            return {
              metadata,
              ...(metadata.canReadReceipt &&
              metadata.contentStatus === "available"
                ? { contentPending: true }
                : {}),
            };
          }
          if (
            !metadata.canReadReceipt ||
            metadata.contentStatus !== "available"
          ) {
            return { metadata };
          }
          try {
            const url = await createTrackedReceiptPreviewUrl(
              () => runtime.expenseActions.readReceipt(metadata.receiptId),
              isCurrent,
              (nextUrl) =>
                existingUrlsRef.current.push({
                  receiptId: metadata.receiptId,
                  url: nextUrl,
                }),
            );
            return url ? { metadata, url } : undefined;
          } catch {
            return isCurrent() ? { metadata, error: true } : undefined;
          }
        },
      ),
    );
    const completeReceiptPreviews = receiptPreviews.filter(
      (receipt): receipt is ExistingReceiptPreview => receipt !== undefined,
    );
    if (
      !isCurrent() ||
      completeReceiptPreviews.length !== receiptPreviews.length
    )
      return;
    setExistingReceipts(completeReceiptPreviews);
    form.reset(editFormValues(view), { keepDirtyValues: true });
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

  useEffect(
    () => () => {
      loadVersionRef.current += 1;
      existingUrlsRef.current.forEach((entry) =>
        URL.revokeObjectURL(entry.url),
      );
      existingUrlsRef.current = [];
      pendingReceiptsRef.current.forEach((receipt) =>
        URL.revokeObjectURL(receipt.url),
      );
    },
    [],
  );

  function stageExistingReceiptRemoval(receiptId: string) {
    if (!receiptRemovalCommandIds.current.has(receiptId)) {
      receiptRemovalCommandIds.current.set(
        receiptId,
        commandId(crypto.randomUUID()),
      );
    }
    setRemovedReceiptIds((current) =>
      current.includes(receiptId) ? current : [...current, receiptId],
    );
    const entry = existingUrlsRef.current.find(
      (candidate) => candidate.receiptId === receiptId,
    );
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    existingUrlsRef.current = existingUrlsRef.current.filter(
      (candidate) => candidate !== entry,
    );
  }

  const draft: ExpenseFormDraft = useMemo(
    () => ({
      name: values.name ?? "",
      iconCategory: values.iconCategory ?? "others",
      amountText: values.amountText ?? "",
      expenseDateText: values.expenseDateText ?? "",
      paymentMethod: values.paymentMethod ?? "cash",
      selectedCardId: values.selectedCardId || undefined,
      participantIds: values.participantIds ?? [],
      splitMethod: values.splitMethod ?? "equal",
      amountTextByParticipant: definedTextRecord(
        values.amountTextByParticipant,
      ),
      percentageTextByParticipant: definedTextRecord(
        values.percentageTextByParticipant,
      ),
    }),
    [values],
  );
  const currentUserId =
    runtime.status === "ready" ? runtime.session.userId : undefined;
  const preview = useMemo(
    () => previewExpenseDraft(draft, currentUserId),
    [currentUserId, draft],
  );
  const memberById = useMemo(
    () =>
      new Map<string, ExpenseMemberView>(
        members.map((member) => [member.userId, member]),
      ),
    [members],
  );
  const financialLocked = original?.financialEditability.state === "locked";
  const expenseMutationsEnabled = useCapability("expenseMutations");
  const receiptMutationsEnabled = useCapability("receiptMutations");
  const saveDisabled = !expenseMutationsEnabled;
  const ownerEditing = original?.expense.creatorId === currentUserId;
  const payerName = original
    ? original.expense.creatorId === currentUserId
      ? "You"
      : (memberById.get(original.expense.creatorId)?.displayName ??
        "Household member")
    : "You";

  const fieldWasInteractedWith = (
    field:
      | "name"
      | "amountText"
      | "expenseDateText"
      | "participantIds"
      | "splitMethod",
  ) =>
    attemptedSubmit ||
    Boolean(
      form.formState.dirtyFields[field] || form.formState.touchedFields[field],
    );
  const splitEntryWasInteractedWith = (
    method: "amount" | "percentage",
    id: string,
  ) => {
    const dirty =
      form.formState.dirtyFields[
        method === "amount"
          ? "amountTextByParticipant"
          : "percentageTextByParticipant"
      ];
    const touched =
      form.formState.touchedFields[
        method === "amount"
          ? "amountTextByParticipant"
          : "percentageTextByParticipant"
      ];
    return (
      attemptedSubmit ||
      Boolean(
        (dirty && typeof dirty === "object" && dirty[id]) ||
          (touched && typeof touched === "object" && touched[id]),
      )
    );
  };
  const splitWasInteractedWith =
    attemptedSubmit ||
    fieldWasInteractedWith("splitMethod") ||
    draft.participantIds.some((id) =>
      splitEntryWasInteractedWith(
        draft.splitMethod === "percentage" ? "percentage" : "amount",
        id,
      ),
    );
  const nameIssue = fieldWasInteractedWith("name")
    ? (form.formState.errors.name?.message ?? preview.issues.name)
    : undefined;
  const amountIssue = fieldWasInteractedWith("amountText")
    ? preview.issues.amountText
    : undefined;
  const dateIssue = fieldWasInteractedWith("expenseDateText")
    ? preview.issues.expenseDateText
    : undefined;
  const participantsIssue = fieldWasInteractedWith("participantIds")
    ? preview.issues.participants
    : undefined;
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
        document
          .querySelector<HTMLInputElement>("#expense-participants input")
          ?.focus();
        return;
      }
      const splitEntry = draft.participantIds.find(
        (id) => preview.issues[`${draft.splitMethod}:${id}`],
      );
      if (splitEntry) {
        document
          .getElementById(`expense-${draft.splitMethod}-share-${splitEntry}`)
          ?.focus();
        return;
      }
      if (preview.issues.split) {
        document
          .querySelector<HTMLInputElement>("#expense-split-method input")
          ?.focus();
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
    const availableExistingCount = existingReceipts.filter(
      ({ metadata }) =>
        metadata.contentStatus === "available" &&
        !removedReceiptIds.includes(metadata.receiptId),
    ).length;
    for (const file of Array.from(files)) {
      if (
        availableExistingCount + pendingReceipts.length + accepted.length >=
        MAX_AVAILABLE_RECEIPTS_PER_EXPENSE
      ) {
        setReceiptError(
          "An Expense can have at most three available receipts.",
        );
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
      accepted.push({
        key: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      });
    }
    if (accepted.length) {
      setReceiptError(undefined);
      pendingReceiptsRef.current = [...pendingReceiptsRef.current, ...accepted];
      setPendingReceipts(pendingReceiptsRef.current);
    }
  }

  function removePendingReceipt(key: string) {
    const target = pendingReceiptsRef.current.find(
      (receipt) => receipt.key === key,
    );
    if (!target) return;
    URL.revokeObjectURL(target.url);
    pendingReceiptsRef.current = pendingReceiptsRef.current.filter(
      (receipt) => receipt.key !== key,
    );
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
      const prepared =
        financialLocked && original
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
            mimeType: receipt.file.type as
              | "image/jpeg"
              | "image/png"
              | "image/webp",
          },
        });
      }

      if (mode === "create") {
        if (draft.paymentMethod === "card" && !draft.selectedCardId) {
          setSubmitError("Select a Card or use Cash.");
          return;
        }
        const selectedCard = cards.find(
          (card) => card.cardId === draft.selectedCardId,
        );
        if (draft.paymentMethod === "card" && !selectedCard) {
          setSubmitError("Select an available Card.");
          return;
        }
        const intentKey = JSON.stringify({
          mode,
          draft,
          receiptKeys: pendingReceipts.map((item) => item.key),
        });
        const created = await runtime.expenseActions.createExpense({
          commandId: expenseCommand.forIntent(intentKey),
          ...(confirmationToken
            ? { backdatedConfirmationToken: confirmationToken }
            : {}),
          householdId: household.householdId,
          name: prepared.name,
          iconCategory: prepared.iconCategory,
          amount: prepared.amount,
          expenseDate: prepared.expenseDate,
          splitMethod: prepared.splitMethod,
          percentageEntries: prepared.percentageEntries,
          allocations: prepared.allocations,
          payment:
            draft.paymentMethod === "cash"
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
      let payment: Parameters<
        typeof runtime.expenseActions.editExpense
      >[0]["payment"];
      if (draft.paymentMethod === original.expense.payment.method) {
        if (
          draft.paymentMethod === "card" &&
          ownerEditing &&
          draft.selectedCardId &&
          draft.selectedCardId !== original.privateCardSnapshot?.cardId
        ) {
          payment = {
            kind: "card",
            cardId: cards.find((card) => card.cardId === draft.selectedCardId)!
              .cardId,
          };
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
      const intentKey = JSON.stringify({
        mode,
        expenseId: original.expense.expenseId,
        revision: original.expense.revision,
        draft,
        receiptKeys: pendingReceipts.map((item) => item.key),
        removedReceiptIds,
      });
      await runtime.expenseActions.editExpense({
        commandId: expenseCommand.forIntent(intentKey),
        ...(confirmationToken
          ? { backdatedConfirmationToken: confirmationToken }
          : {}),
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
          removedReceiptIds.map((id) => [
            id,
            receiptRemovalCommandIds.current.get(id) ??
              commandId(crypto.randomUUID()),
          ]),
        ),
      });
      expenseCommand.complete();
      setBackdatedConfirmationToken(undefined);
      router.push(`/expenses/${original.expense.expenseId}`);
    } catch (error) {
      if (error instanceof ReceiptSagaPartialSuccessError) {
        if (mode === "edit" && original) {
          try {
            const refreshed = await runtime.expenseActions.getExpense(
              parseExpenseId(error.savedExpenseId),
            );
            setOriginal(refreshed);
            form.reset(editFormValues(refreshed, form.getValues("name")));
          } catch {
            // The explicit partial-success message remains accurate even if refresh is temporarily unavailable.
          }
        }
        setSubmitError(error.message);
        return;
      }
      if (
        error instanceof ApplicationError &&
        error.code === "BACKDATED_EXPENSE_CONFIRMATION_REQUIRED"
      ) {
        const token =
          "confirmationToken" in error
            ? String(error.confirmationToken)
            : undefined;
        if (token) {
          setBackdatedConfirmationToken(token);
          return;
        }
      }
      if (
        error instanceof ApplicationError &&
        error.code === "EXPENSE_VERSION_CONFLICT" &&
        original
      ) {
        try {
          const refreshed = await runtime.expenseActions.getExpense(
            original.expense.expenseId,
          );
          const nameDraft = form.getValues("name");
          setOriginal(refreshed);
          form.reset(editFormValues(refreshed, nameDraft));
          expenseCommand.complete();
          setBackdatedConfirmationToken(undefined);
          setSubmitError(
            "This expense changed while you were editing it. Refresh and review the latest version before saving.",
          );
          return;
        } catch {
          setSubmitError(
            "This expense changed while you were editing it. Refresh and review the latest version before saving.",
          );
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
      setSubmitError(
        userErrorMessage(error, "The expense could not be saved."),
      );
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
    return (
      <PageContainer>
        <Surface>
          <p role="status">Loading expense form…</p>
        </Surface>
      </PageContainer>
    );
  }
  if (loadFailed) {
    return (
      <PageContainer>
        <ErrorState
          description="The expense could not be loaded. Your saved financial data was not changed."
          onRetry={() => {
            setLoadFailed(false);
            setLoading(true);
            setLoadTick((value) => value + 1);
          }}
          title="Expense form unavailable"
        />
      </PageContainer>
    );
  }
  if (original?.financialEditability.state === "deleted") {
    return (
      <PageContainer>
        <Surface>
          <div role="status" className="p-4">
            <p className="font-semibold text-danger">
              This deleted expense is read-only.
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Deleted expenses remain as read-only household history and can no
              longer be edited or deleted again.
            </p>
          </div>
        </Surface>
      </PageContainer>
    );
  }

  const allocationStatus =
    preview.remaining !== undefined
      ? preview.remaining < 0
        ? `Over by ${formatBdt(poisha(-preview.remaining))}`
        : `Remaining ${formatBdt(preview.remaining)}`
      : "Complete the expense details";
  const availableExistingReceipts = existingReceipts.filter(
    ({ metadata }) =>
      metadata.contentStatus === "available" &&
      !removedReceiptIds.includes(metadata.receiptId),
  );
  const availableReceiptCount =
    availableExistingReceipts.length + pendingReceipts.length;
  const releasedReceiptBytes = existingReceipts.reduce(
    (total, item) =>
      total +
      (item.metadata.contentStatus === "available" &&
      removedReceiptIds.includes(item.metadata.receiptId)
        ? item.metadata.sizeBytes
        : 0),
    0,
  );
  const pendingReceiptBytes = pendingReceipts.reduce(
    (total, item) => total + item.file.size,
    0,
  );
  const remainingUploaderReceiptBytes = Math.max(
    0,
    RECEIPT_USER_QUOTA_BYTES -
      uploaderAvailableReceiptBytes +
      releasedReceiptBytes -
      pendingReceiptBytes,
  );

  return (
    <PageContainer>
      <Button
        asChild
        variant="ghost"
        className="-ml-3 min-h-11 rounded-xl lg:min-h-9"
      >
        <Link
          href={
            original ? `/expenses/${original.expense.expenseId}` : "/expenses"
          }
        >
          <ArrowLeft /> Back to expenses
        </Link>
      </Button>
      <PageHeader
        className="mt-[14px]"
        title={mode === "create" ? "Add Expense" : "Edit Expense"}
        description={
          mode === "create"
            ? "Record what you paid and allocate every poisha exactly."
            : "Payer and creator remain fixed; permitted changes recalculate from source history."
        }
      />
      {financialLocked ? (
        <div
          className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-foreground"
          role="status"
        >
          <p className="font-semibold">
            {original?.financialEditability.title}
          </p>
          <p className="mt-1">{original?.financialEditability.description}</p>
          <p className="mt-1 text-text-secondary">
            Expense Name, category, and receipts may still be updated.
          </p>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(backdatedConfirmationToken)}
        onOpenChange={(open) => {
          if (!open) {
            setBackdatedConfirmationToken(undefined);
            expenseCommand.complete();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Expense dated before a confirmed settlement
            </AlertDialogTitle>
            <AlertDialogDescription>
              This expense is dated before a household settlement that was
              already confirmed. Adding it may create new outstanding balances
              even though earlier balances were previously settled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (saving) return;
                const token = backdatedConfirmationToken;
                if (token) void saveExpense(token);
              }}
            >
              {saving
                ? "Saving…"
                : mode === "create"
                  ? "Add Expense"
                  : "Save Changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <form
        className="expense-form-grid mt-7 grid gap-6"
        onSubmit={form.handleSubmit(() => saveExpense(), revealErrorsAndFocus)}
        noValidate
      >
        <div className="grid content-start gap-4">
          <ExpenseDetailsSection
            nameIssue={nameIssue}
            form={form}
            values={values}
            financialLocked={financialLocked}
            amountIssue={amountIssue}
            earliestExpenseDate={earliestExpenseDate}
            businessDate={businessDate}
            dateIssue={dateIssue}
            payerName={payerName}
            original={original}
            ownerEditing={ownerEditing}
            draft={draft}
            mode={mode}
            cards={cards}
            confirmCardToCash={confirmCardToCash}
            setConfirmCardToCash={setConfirmCardToCash}
          />

          <ExpenseSplitSection
            financialLocked={financialLocked}
            members={members}
            draft={draft}
            toggleParticipant={toggleParticipant}
            currentUserId={currentUserId}
            participantsIssue={participantsIssue}
            form={form}
            original={original}
            memberById={memberById}
            preview={preview}
            splitEntryWasInteractedWith={splitEntryWasInteractedWith}
            splitIssue={splitIssue}
          />

          <ExpenseReceiptsSection
            original={original}
            availableReceiptCount={availableReceiptCount}
            remainingUploaderReceiptBytes={remainingUploaderReceiptBytes}
            receiptMutationsEnabled={receiptMutationsEnabled}
            addReceiptFiles={addReceiptFiles}
            receiptError={receiptError}
            existingReceipts={existingReceipts}
            removedReceiptIds={removedReceiptIds}
            stageExistingReceiptRemoval={stageExistingReceiptRemoval}
            pendingReceipts={pendingReceipts}
            removePendingReceipt={removePendingReceipt}
          />
        </div>

        <ExpenseSummarySection
          preview={preview}
          draft={draft}
          financialLocked={financialLocked}
          allocationStatus={allocationStatus}
          submitError={submitError}
          submitErrorRef={submitErrorRef}
          original={original}
          pendingSave={pendingSave}
          saveDisabled={saveDisabled}
          mode={mode}
        />
      </form>
    </PageContainer>
  );
}
