"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Banknote, Check, CreditCard, Paperclip, ShieldCheck, Trash2, Upload } from "lucide-react";
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
import type { MyCardSummaryView } from "@/application/cards/card-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCanonicalBdt, poisha } from "@/domain/money/poisha";
import type { ReceiptMetadata } from "@/domain/records/domain-records";
import { expenseId as parseExpenseId, receiptId as parseReceiptId } from "@/domain/shared/identifiers";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { Surface } from "@/presentation/components/surface";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import {
  currentLocalDateText,
  formatBasisPoints,
  selectClassName,
} from "./expense-ui";

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

interface PendingReceipt {
  readonly key: string;
  readonly file: File;
  readonly url: string;
}

interface ExistingReceiptPreview {
  readonly metadata: ReceiptMetadata;
  readonly url?: string;
  readonly error?: boolean;
}

function receiptBlob(bytes: Uint8Array, type: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type });
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
  amountText: "",
  expenseDateText: currentLocalDateText(),
  paymentMethod: "cash",
  selectedCardId: "",
  participantIds: [],
  splitMethod: "equal",
  amountTextByParticipant: {},
  percentageTextByParticipant: {},
};

interface ExpenseFormPageClientProps {
  readonly mode: "create" | "edit";
  readonly expenseId?: string;
}

export function ExpenseFormPageClient({ mode, expenseId }: ExpenseFormPageClientProps) {
  const runtime = useApplicationRuntime();
  const router = useRouter();
  const [members, setMembers] = useState<readonly ExpenseMemberView[]>([]);
  const [cards, setCards] = useState<readonly MyCardSummaryView[]>([]);
  const [original, setOriginal] = useState<ExpenseView>();
  const [existingReceipts, setExistingReceipts] = useState<readonly ExistingReceiptPreview[]>([]);
  const [removedReceiptIds, setRemovedReceiptIds] = useState<readonly string[]>([]);
  const [pendingReceipts, setPendingReceipts] = useState<readonly PendingReceipt[]>([]);
  const [receiptError, setReceiptError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [confirmCardToCash, setConfirmCardToCash] = useState(false);
  const existingUrlsRef = useRef<string[]>([]);
  const pendingReceiptsRef = useRef<readonly PendingReceipt[]>([]);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: emptyValues,
  });
  const values = useWatch({ control: form.control });

  const household = runtime.status === "ready" &&
    (runtime.household.status === "active-member" || runtime.household.status === "active-leader")
    ? runtime.household.household
    : undefined;

  const load = useCallback(async () => {
    if (runtime.status !== "ready" || !household) return;
    const [nextMembers, nextCards] = await Promise.all([
      runtime.expenseActions.listMembers(household.householdId),
      runtime.expenseActions.listSelectableCards(),
    ]);
    setMembers(nextMembers);
    setCards(nextCards);

    if (mode === "create") {
      form.reset({
        ...emptyValues,
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
    setOriginal(view);
    existingUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    existingUrlsRef.current = [];
    const receiptPreviews: ExistingReceiptPreview[] = [];
    for (const metadata of receipts) {
      try {
        const content = await runtime.expenseActions.readReceipt(metadata.receiptId);
        const url = URL.createObjectURL(
          receiptBlob(content.bytes, content.mimeType),
        );
        existingUrlsRef.current.push(url);
        receiptPreviews.push({ metadata, url });
      } catch {
        receiptPreviews.push({ metadata, error: true });
      }
    }
    setExistingReceipts(receiptPreviews);
    const amountTextByParticipant = Object.fromEntries(
      view.expense.allocations.map((allocation) => [
        allocation.participantId,
        formatCanonicalBdt(allocation.share),
      ]),
    );
    const percentageTextByParticipant = Object.fromEntries(
      (view.expense.percentageEntries ?? []).map((entry) => [
        entry.participantId,
        formatBasisPoints(entry.basisPoints),
      ]),
    );
    form.reset({
      name: view.expense.name,
      amountText: formatCanonicalBdt(view.expense.amount),
      expenseDateText: view.expense.expenseDate,
      paymentMethod: view.expense.payment.method,
      selectedCardId: view.privateCardSnapshot?.cardId ?? "",
      participantIds: view.expense.allocations.map((allocation) => allocation.participantId),
      splitMethod: view.expense.splitMethod,
      amountTextByParticipant,
      percentageTextByParticipant,
    });
    setLoading(false);
  }, [expenseId, form, household, mode, runtime]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load().catch(() => {
        setSubmitError("The expense form could not be loaded.");
        setLoading(false);
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    pendingReceiptsRef.current = pendingReceipts;
  }, [pendingReceipts]);

  useEffect(() => () => {
    existingUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    pendingReceiptsRef.current.forEach((receipt) => URL.revokeObjectURL(receipt.url));
  }, []);

  const draft: ExpenseFormDraft = useMemo(() => ({
    name: values.name ?? "",
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
  const financialLocked = original !== undefined && original.financialEditState !== "editable";
  const ownerEditing = original?.expense.creatorId === currentUserId;
  const payerName = original
    ? original.expense.creatorId === currentUserId
      ? "You"
      : memberById.get(original.expense.creatorId)?.displayName ?? "Household member"
    : "You";

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
    for (const file of Array.from(files)) {
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
      setPendingReceipts((current) => [...current, ...accepted]);
    }
  }

  function removePendingReceipt(key: string) {
    setPendingReceipts((current) => {
      const target = current.find((receipt) => receipt.key === key);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((receipt) => receipt.key !== key);
    });
  }

  async function onSubmit() {
    if (runtime.status !== "ready" || !household) return;
    setSubmitError(undefined);
    setReceiptError(undefined);
    try {
      const prepared = financialLocked && original
        ? {
            name: form.getValues("name").trim(),
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
        const created = await runtime.expenseActions.createExpense({
          householdId: household.householdId,
          name: prepared.name,
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
      await runtime.expenseActions.editExpense({
        expenseId: original.expense.expenseId,
        name: prepared.name,
        amount: prepared.amount,
        expenseDate: prepared.expenseDate,
        splitMethod: prepared.splitMethod,
        percentageEntries: prepared.percentageEntries,
        allocations: prepared.allocations,
        payment,
        newReceipts,
        removedReceiptIds: removedReceiptIds.map(parseReceiptId),
      });
      router.push(`/expenses/${original.expense.expenseId}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The expense could not be saved.");
    }
  }

  if (loading) {
    return <PageContainer><Surface><p role="status">Loading expense form…</p></Surface></PageContainer>;
  }
  if (original?.financialEditState === "deleted") {
    return <PageContainer><Surface><p>This deleted expense is read-only.</p></Surface></PageContainer>;
  }

  const allocationStatus = preview.remaining !== undefined
    ? preview.remaining < 0
      ? `Over by ${formatBdt(poisha(-preview.remaining))}`
      : `Remaining ${formatBdt(preview.remaining)}`
    : "Complete the expense details";

  return (
    <PageContainer>
      <Button asChild variant="ghost" className="-ml-3 h-9 rounded-xl"><Link href={original ? `/expenses/${original.expense.expenseId}` : "/expenses"}><ArrowLeft /> Back to expenses</Link></Button>
      <PageHeader className="mt-[14px]" title={mode === "create" ? "Add Expense" : "Edit Expense"} description={mode === "create" ? "Record what you paid and allocate every poisha exactly." : "Payer and creator remain fixed; permitted changes recalculate from source history."} />
      {financialLocked ? <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-foreground" role="status">Financial fields are read-only because {original?.financialEditState === "former-member-frozen" ? "this expense includes a former member" : "the original percentage inputs are unavailable"}. Name and receipts may still be updated.</div> : null}

      <form className="expense-form-grid mt-7 grid gap-6" onSubmit={form.handleSubmit(onSubmit, () => form.setFocus("name"))} noValidate>
        <div className="grid content-start gap-[18px]">
          <Surface className="expense-details-panel order-1 space-y-3" padding="canonical">
            <h2 className="panel-title">Expense Details</h2>
            <div className="expense-details-fields grid gap-3 sm:grid-cols-2">
              <div className="expense-name-field space-y-1 sm:col-span-2"><Label htmlFor="expense-name">Expense Name</Label><Input id="expense-name" aria-invalid={Boolean(form.formState.errors.name || preview.issues.name)} aria-describedby="expense-name-error" {...form.register("name")} /><p id="expense-name-error" className="text-caption text-danger">{form.formState.errors.name?.message ?? preview.issues.name}</p></div>
              <div className="space-y-1"><Label htmlFor="expense-amount">Amount (BDT)</Label><Input id="expense-amount" inputMode="decimal" disabled={financialLocked} aria-invalid={Boolean(preview.issues.amountText)} aria-describedby="expense-amount-error" {...form.register("amountText")} /><p id="expense-amount-error" className="text-caption text-danger">{preview.issues.amountText}</p></div>
              <div className="space-y-1"><Label htmlFor="expense-date">Expense Date</Label><Input id="expense-date" type="date" disabled={financialLocked} aria-invalid={Boolean(preview.issues.expenseDateText)} aria-describedby="expense-date-error" {...form.register("expenseDateText")} /><p id="expense-date-error" className="text-caption text-danger">{preview.issues.expenseDateText}</p></div>
              <div className="space-y-1"><Label>Paid By</Label><div className="flex h-11 items-center rounded-md border bg-secondary px-3 text-sm">{payerName}</div></div>
            </div>
            <fieldset disabled={financialLocked || (Boolean(original) && !ownerEditing && original?.expense.payment.method === "cash")}>
              <legend className="text-label font-medium">Payment Method</legend>
              <div className="mt-2 grid grid-cols-2 rounded-xl bg-secondary p-1">
                {(["cash", "card"] as const).map((method) => <label key={method} className={`relative flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[9px] text-sm font-medium focus-within:ring-3 focus-within:ring-ring/30 ${draft.paymentMethod === method ? "bg-card shadow-[var(--shadow-small)]" : "text-text-secondary"}`}><input className="absolute inset-0 z-10 size-full cursor-pointer opacity-0" type="radio" value={method} {...form.register("paymentMethod")} />{method === "cash" ? <Banknote aria-hidden="true" className="size-4" /> : <CreditCard aria-hidden="true" className="size-4" />}<span className="capitalize">{method}</span></label>)}
              </div>
            </fieldset>
            {draft.paymentMethod === "card" ? (
              ownerEditing || mode === "create" ? <div className="space-y-2"><Label htmlFor="expense-card">Your Card</Label><select id="expense-card" className={selectClassName()} disabled={financialLocked} {...form.register("selectedCardId")}><option value="">{cards.length ? "Select a Card" : "No cards available"}</option>{original?.privateCardSnapshot && !cards.some((card) => card.cardId === original.privateCardSnapshot?.cardId) ? <option value={original.privateCardSnapshot.cardId}>Keep {original.privateCardSnapshot.cardName} (archived)</option> : null}{cards.map((card) => <option key={card.cardId} value={card.cardId}>{card.name} · {card.type}</option>)}</select>{cards.length === 0 && !original?.privateCardSnapshot ? <p className="text-sm text-text-secondary">No cards available. <Link className="font-medium text-foreground underline underline-offset-4" href="/cards">Add a private Card label in My Cards</Link>, or use Cash.</p> : null}</div> : <p className="text-sm text-text-secondary">The existing private Card association will be preserved opaquely.</p>
            ) : null}
            {original?.expense.payment.method === "card" && draft.paymentMethod === "cash" ? <label className="flex min-h-11 items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-3"><input className="mt-1" type="checkbox" checked={confirmCardToCash} onChange={(event) => setConfirmCardToCash(event.target.checked)} /><span>Confirm changing the current Payment Method from Card to Cash.</span></label> : null}
          </Surface>

          <Surface className="split-expense-panel order-3 space-y-3" padding="canonical">
            <h2 className="panel-title">Split Expense</h2>
            <fieldset disabled={financialLocked}>
              <legend className="text-label font-medium">Participants</legend>
              <p className="mt-1 text-sm text-text-secondary">Select at least one household member. You may exclude yourself.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {members.filter((member) => member.status === "active" || draft.participantIds.includes(member.userId)).map((member) => { const selected = draft.participantIds.includes(member.userId); return <label key={member.userId} className={`relative flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 focus-within:ring-3 focus-within:ring-ring/30 ${selected ? "border-foreground bg-secondary" : "bg-card"}`}><input className="absolute inset-0 z-10 size-full cursor-pointer opacity-0" type="checkbox" checked={selected} onChange={(event) => toggleParticipant(member.userId, event.target.checked)} /><MemberAvatar className="size-7 [&_[data-slot=avatar-fallback]]:text-[9px]" displayName={member.displayName} /><span className="min-w-0 flex-1 truncate text-xs font-medium">{member.userId === currentUserId ? "You" : member.displayName}{member.status === "former" ? " (Former member)" : ""}</span>{selected ? <Check aria-hidden="true" className="size-4" /> : null}</label>; })}
              </div>
              {preview.issues.participants ? <p className="mt-2 text-sm text-danger" role="alert">{preview.issues.participants}</p> : null}
            </fieldset>
            <fieldset disabled={financialLocked}>
              <legend className="sr-only">Split Method</legend>
              <div className="grid grid-cols-3 rounded-xl bg-secondary p-1">{(["equal", "amount", "percentage"] as const).map((method) => <label key={method} className={`relative flex h-9 cursor-pointer items-center justify-center rounded-[9px] text-xs font-medium capitalize focus-within:ring-3 focus-within:ring-ring/30 ${draft.splitMethod === method ? "bg-card shadow-[var(--shadow-small)]" : "text-text-secondary"}`}><input className="absolute inset-0 z-10 size-full cursor-pointer opacity-0" type="radio" value={method} {...form.register("splitMethod")} /> {method}</label>)}</div>
            </fieldset>
            {original?.percentageSourceStatus === "legacy-percentage-input-unavailable" ? <p className="rounded-lg bg-warning-soft p-3 text-sm" role="status">Original percentage inputs are unavailable. No percentages have been inferred from the saved poisha shares.</p> : null}
            <div className="grid gap-2 sm:grid-cols-3">
              {draft.participantIds.map((id) => {
                const member = memberById.get(id);
                const allocation = preview.allocations.find((item) => item.participantId === id);
                return <div key={id} className="grid items-center gap-1 rounded-xl border p-3"><span className="truncate text-xs font-medium">{id === currentUserId ? "You" : member?.displayName ?? "Member"}</span>{draft.splitMethod === "amount" ? <Input className="h-9" disabled={financialLocked} inputMode="decimal" aria-label={`Amount share for ${member?.displayName ?? id}`} value={draft.amountTextByParticipant[id] ?? ""} onChange={(event) => form.setValue(`amountTextByParticipant.${id}`, event.target.value, { shouldDirty: true })} /> : draft.splitMethod === "percentage" ? <div className="relative"><Input disabled={financialLocked} inputMode="decimal" aria-label={`Percentage share for ${member?.displayName ?? id}`} className="h-9 pr-8" value={draft.percentageTextByParticipant[id] ?? ""} onChange={(event) => form.setValue(`percentageTextByParticipant.${id}`, event.target.value, { shouldDirty: true })} /><span className="absolute right-3 top-2 text-text-muted">%</span></div> : <span className="text-[11px] text-text-muted">Calculated equally</span>}<span className="financial-numerals text-xs font-semibold">{allocation ? formatBdt(allocation.share) : "—"}{preview.provisional && draft.splitMethod === "percentage" ? <small className="block text-warning">Provisional</small> : null}</span><p className="text-caption text-danger">{preview.issues[`${draft.splitMethod}:${id}`]}</p></div>;
              })}
            </div>
            {preview.issues.split ? <p className="text-sm text-danger" role="status">{preview.issues.split}</p> : null}
          </Surface>

          <Surface className="receipts-panel order-2 space-y-3" padding="canonical">
            <div><h2 className="panel-title">Receipts</h2><p className="compact-caption mt-0.5 text-text-muted">Optional JPEG, PNG, or WebP images, up to 10 MiB each.</p></div>
            <Label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm"><Upload className="size-4" /> Add receipt images<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { addReceiptFiles(event.target.files); event.target.value = ""; }} /></Label>
            {receiptError ? <p className="text-sm text-danger" role="alert">{receiptError}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {existingReceipts.filter(({ metadata }) => !removedReceiptIds.includes(metadata.receiptId)).map(({ metadata, url, error }) => <div key={metadata.receiptId} className="rounded-xl border p-3">{url ? <span className="block h-28 overflow-hidden rounded-lg"><Image className="min-h-full object-cover" src={url} alt={metadata.originalFilename ?? "Expense receipt"} width={240} height={112} style={{ width: "100%", height: "auto" }} unoptimized /></span> : <div className="flex h-28 items-center justify-center rounded-lg bg-secondary"><Paperclip /><span className="sr-only">{error ? "Receipt preview unavailable" : "Loading receipt preview"}</span></div>}<p className="mt-2 truncate text-sm">{metadata.originalFilename ?? "Receipt image"}</p><Button type="button" variant="ghost" size="sm" onClick={() => setRemovedReceiptIds((current) => [...current, metadata.receiptId])}><Trash2 /> Remove</Button></div>)}
              {pendingReceipts.map((receipt) => <div key={receipt.key} className="rounded-xl border p-3"><span className="block h-28 overflow-hidden rounded-lg"><Image className="min-h-full object-cover" src={receipt.url} alt={receipt.file.name} width={240} height={112} style={{ width: "100%", height: "auto" }} unoptimized /></span><p className="mt-2 truncate text-sm">{receipt.file.name}</p><Button type="button" variant="ghost" size="sm" onClick={() => removePendingReceipt(receipt.key)}><Trash2 /> Remove</Button></div>)}
            </div>
          </Surface>
        </div>

        <aside className="flex self-stretch flex-col gap-[18px] min-[1400px]:min-h-[808px]">
          <Surface className="min-h-[450px]" elevation="card" padding="canonical">
            <h2 className="panel-title">Summary</h2>
            <dl className="space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-text-secondary">Expense Total</dt><dd className="font-semibold tabular-nums">{preview.amount ? formatBdt(preview.amount) : "—"}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-secondary">Allocated</dt><dd className="tabular-nums">{preview.allocated !== undefined ? formatBdt(preview.allocated) : "—"}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-secondary">Your Share</dt><dd className="tabular-nums">{formatBdt(preview.yourShare)}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-secondary">Participants</dt><dd>{preview.participantCount}</dd></div><div className="flex justify-between gap-4"><dt className="text-text-secondary">Payment Method</dt><dd className="capitalize">{draft.paymentMethod}</dd></div><div className="border-t pt-3"><dt className="text-text-secondary">Allocation Status</dt><dd className={preview.canPersist || financialLocked ? "mt-1 font-medium text-success" : "mt-1 font-medium text-warning"}>{financialLocked ? "Financial history preserved" : allocationStatus}</dd></div></dl>
            {submitError ? <div className="mt-5 rounded-lg bg-danger-soft p-3 text-sm text-danger" role="alert" tabIndex={-1}>{submitError}</div> : null}
          </Surface>
          <Surface className="min-h-[104px]" padding="canonical"><div className="flex gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft"><ShieldCheck aria-hidden="true" className="size-4" /></span><div><h2 className="text-sm font-semibold">Privacy Note</h2><p className="compact-caption mt-1 text-text-muted">Private Card details remain visible only to the Card owner.</p></div></div></Surface>
          <div className="mt-auto grid grid-cols-[116px_minmax(0,1fr)] gap-3"><Button type="button" variant="outline" asChild><Link href={original ? `/expenses/${original.expense.expenseId}` : "/expenses"}>Cancel</Link></Button><Button type="submit" disabled={form.formState.isSubmitting || (!financialLocked && !preview.canPersist)}>{form.formState.isSubmitting ? "Saving…" : mode === "create" ? "Create Expense" : "Save Changes"}</Button></div>
        </aside>
      </form>
    </PageContainer>
  );
}
