"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, CreditCard, Pencil, ReceiptText, Trash2, UserRound } from "lucide-react";

import type {
  ExpenseActivityView,
  ExpenseMemberView,
  ExpenseView,
} from "@/application/services/application-services";
import { Button } from "@/components/ui/button";
import type { ReceiptMetadata } from "@/domain/records/domain-records";
import { expenseId as parseExpenseId } from "@/domain/shared/identifiers";
import { ConfirmDialog } from "@/presentation/components/confirm-dialog";
import { Surface } from "@/presentation/components/surface";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { getCardPaletteOption } from "@/presentation/cards/card-palette";
import { formatBasisPoints, formatExpenseDate } from "./expense-ui";

interface ReceiptPreview {
  readonly metadata: ReceiptMetadata;
  readonly url?: string;
  readonly error?: boolean;
}

function receiptBlob(bytes: Uint8Array, type: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type });
}

export function ExpenseDetailsPageClient({ expenseId }: { readonly expenseId: string }) {
  const runtime = useApplicationRuntime();
  const router = useRouter();
  const [view, setView] = useState<ExpenseView>();
  const [members, setMembers] = useState<readonly ExpenseMemberView[]>([]);
  const [receipts, setReceipts] = useState<readonly ReceiptPreview[]>([]);
  const [activity, setActivity] = useState<readonly ExpenseActivityView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const urlsRef = useRef<string[]>([]);

  const household = runtime.status === "ready" &&
    (runtime.household.status === "active-member" || runtime.household.status === "active-leader")
    ? runtime.household.household
    : undefined;

  const load = useCallback(async () => {
    if (runtime.status !== "ready" || !household) return;
    const id = parseExpenseId(expenseId);
    const [nextView, nextMembers, metadata, nextActivity] = await Promise.all([
      runtime.expenseActions.getExpense(id),
      runtime.expenseActions.listMembers(household.householdId),
      runtime.expenseActions.listReceipts(id),
      runtime.expenseActions.listActivity(id),
    ]);
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    const nextReceipts: ReceiptPreview[] = [];
    for (const receipt of metadata) {
      try {
        const content = await runtime.expenseActions.readReceipt(receipt.receiptId);
        const url = URL.createObjectURL(receiptBlob(content.bytes, content.mimeType));
        urlsRef.current.push(url);
        nextReceipts.push({ metadata: receipt, url });
      } catch {
        nextReceipts.push({ metadata: receipt, error: true });
      }
    }
    setView(nextView);
    setMembers(nextMembers);
    setReceipts(nextReceipts);
    setActivity(nextActivity);
    setStatus("ready");
  }, [expenseId, household, runtime]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load().catch(() => setStatus("error"));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => () => urlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const memberById = useMemo(() => new Map(members.map((member) => [member.userId, member])), [members]);

  if (status === "loading") return <PageContainer><Surface><p role="status">Loading expense details…</p></Surface></PageContainer>;
  if (status === "error" || !view) return <PageContainer><Surface><p role="alert" className="text-danger">Expense details could not be loaded.</p></Surface></PageContainer>;
  if (runtime.status !== "ready") return <PageContainer><Surface><p role="status">Loading application…</p></Surface></PageContainer>;

  const expenseActions = runtime.expenseActions;

  const { expense } = view;
  const payer = memberById.get(expense.payerId);
  const splitLabel = expense.splitMethod === "percentage" && view.percentageSourceStatus === "legacy-percentage-input-unavailable"
    ? "Percentage · original inputs unavailable"
    : expense.splitMethod;
  const privateCardPalette = view.privateCardSnapshot
    ? getCardPaletteOption(view.privateCardSnapshot.colorId)
    : undefined;

  return (
    <PageContainer className="space-y-6">
      <Button asChild variant="ghost" className="-ml-3"><Link href="/expenses"><ArrowLeft /> Back to expenses</Link></Button>
      <PageHeader
        title={expense.name}
        description={expense.deletedAt ? "Deleted historical expense · read-only" : "Household expense details"}
        action={<div className="flex flex-wrap gap-2">{view.permissions.canEdit ? <Button asChild variant="outline"><Link href={`/expenses/${expense.expenseId}/edit`}><Pencil /> Edit</Link></Button> : null}{view.permissions.canDelete ? <ConfirmDialog destructive title="Delete this expense?" description="The expense will leave normal lists and balances, while its audit history and receipts remain retained." confirmLabel="Delete Expense" trigger={<Button variant="destructive"><Trash2 /> Delete</Button>} onConfirm={async () => { await expenseActions.deleteExpense(expense.expenseId); router.push("/expenses"); }} /> : null}</div>}
      />
      {expense.deletedAt ? <div className="rounded-xl border border-danger/20 bg-danger-soft p-4 font-medium text-danger" role="status">Deleted</div> : null}
      {view.financialEditState === "former-member-frozen" ? <div className="rounded-xl bg-warning-soft p-4 text-sm" role="status">Financial history is frozen because this expense involves a former member.</div> : null}
      {view.financialEditState === "legacy-percentage-input-unavailable" ? <div className="rounded-xl bg-warning-soft p-4 text-sm" role="status">Original percentage inputs were not stored. Saved poisha shares remain effective; no percentages are invented.</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Surface className="space-y-5">
            <div className="flex items-end justify-between gap-4 border-b pb-5"><div><p className="text-label text-text-secondary">Expense amount</p><p className="mt-1 text-[2rem] font-semibold tabular-nums">{formatBdt(expense.amount)}</p></div><span className="rounded-full bg-accent-soft px-3 py-1 text-sm capitalize">{expense.payment.method}</span></div>
            <div className="grid gap-4 sm:grid-cols-2"><div className="flex gap-3"><CalendarDays className="mt-0.5 size-5 text-text-muted" /><div><p className="text-label text-text-secondary">Expense Date</p><p>{formatExpenseDate(expense.expenseDate)}</p></div></div><div className="flex gap-3"><UserRound className="mt-0.5 size-5 text-text-muted" /><div><p className="text-label text-text-secondary">Paid By</p><p>{expense.payerId === runtime.session.userId ? "You" : payer?.displayName ?? "Unknown member"}{payer?.status === "former" ? " (Former member)" : ""}</p></div></div><div className="flex gap-3"><CreditCard className="mt-0.5 size-5 text-text-muted" /><div><p className="text-label text-text-secondary">Payment Method</p><p className="capitalize">{expense.payment.method}</p>{view.privateCardSnapshot && privateCardPalette ? <p className="flex items-center gap-2 text-sm text-text-secondary"><span aria-hidden="true" className="size-3 rounded-full border border-black/10" style={{ backgroundColor: privateCardPalette.hex }} />{view.privateCardSnapshot.cardName} · {view.privateCardSnapshot.cardType} · {privateCardPalette.label}</p> : null}</div></div><div><p className="text-label text-text-secondary">Split Method</p><p className="capitalize">{splitLabel}</p></div></div>
          </Surface>

          <Surface className="space-y-4"><h2 className="text-h3">Participants and shares</h2><ul className="divide-y">{expense.allocations.map((allocation) => { const member = memberById.get(allocation.participantId); const source = expense.percentageEntries?.find((entry) => entry.participantId === allocation.participantId); return <li key={allocation.participantId} className="flex min-h-14 items-center justify-between gap-4 py-3"><div><p className="font-medium">{allocation.participantId === runtime.session.userId ? "You" : member?.displayName ?? "Unknown member"}</p><p className="text-caption text-text-secondary">{member?.status === "former" ? "Former member" : "Household member"}{source ? ` · ${formatBasisPoints(source.basisPoints)}%` : ""}</p></div><span className="font-semibold tabular-nums">{formatBdt(allocation.share)}</span></li>; })}</ul></Surface>

          <Surface className="space-y-4"><div className="flex items-center gap-2"><ReceiptText /><h2 className="text-h3">Receipts</h2></div>{receipts.length === 0 ? <p className="text-text-secondary">No receipts attached.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{receipts.map(({ metadata, url, error }) => <div key={metadata.receiptId} className="rounded-xl border p-3">{url ? <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${metadata.originalFilename ?? "receipt"}`}><Image className="h-32 w-full rounded-lg object-cover" src={url} alt={metadata.originalFilename ?? "Expense receipt"} width={260} height={128} unoptimized /></a> : <div className="flex h-32 items-center justify-center rounded-lg bg-secondary text-sm text-text-secondary">{error ? "Preview unavailable" : "Loading preview"}</div>}<p className="mt-2 truncate text-sm">{metadata.originalFilename ?? "Receipt image"}</p>{view.permissions.canEdit ? <ConfirmDialog destructive title="Remove this receipt?" description="Its metadata tombstone will remain for audit, while the local image Blob is removed." confirmLabel="Remove Receipt" trigger={<Button className="mt-2" size="sm" variant="ghost"><Trash2 /> Remove</Button>} onConfirm={async () => { await expenseActions.deleteReceipt(metadata.receiptId); await load(); }} /> : null}</div>)}</div>}</Surface>

          <Surface className="space-y-4"><h2 className="text-h3">Activity</h2>{activity.length === 0 ? <p className="text-text-secondary">No supported activity information.</p> : <ol className="space-y-3">{activity.map((item, index) => <li key={`${item.occurredAt}-${index}`} className="rounded-xl border p-3"><p className="font-medium capitalize">{item.action.replaceAll("-", " ")}</p><p className="text-sm text-text-secondary">{item.actorName} · {new Date(item.occurredAt).toLocaleString()}</p><p className="text-caption text-text-secondary">Changed: {item.changedFields.join(", ")}</p></li>)}</ol>}</Surface>
        </div>

        <aside className="self-start xl:sticky xl:top-6"><Surface elevation="card" className="space-y-4"><h2 className="text-h3">Summary</h2><dl className="space-y-3 text-sm"><div className="flex justify-between"><dt className="text-text-secondary">Total</dt><dd className="font-semibold tabular-nums">{formatBdt(expense.amount)}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Participants</dt><dd>{expense.allocations.length}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Payment</dt><dd className="capitalize">{expense.payment.method}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Split</dt><dd className="capitalize">{expense.splitMethod}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Status</dt><dd>{expense.deletedAt ? "Deleted" : "Active"}</dd></div></dl></Surface></aside>
      </div>
    </PageContainer>
  );
}
