"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, CreditCard, ImageOff, MoreHorizontal, Pencil, ReceiptText, Trash2, UserRound } from "lucide-react";

import type {
  ExpenseActivityView,
  ExpenseMemberView,
  ExpenseView,
} from "@/application/services/application-services";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReceiptMetadata } from "@/domain/records/domain-records";
import { expenseId as parseExpenseId } from "@/domain/shared/identifiers";
import { ConfirmDialog } from "@/presentation/components/confirm-dialog";
import { Surface } from "@/presentation/components/surface";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
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

function ReceiptPreviewImage({ url, alt }: Readonly<{ url: string; alt: string }>) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className="flex h-24 flex-col items-center justify-center gap-2 rounded-xl bg-secondary text-xs text-text-secondary"><ImageOff aria-hidden="true" className="size-5" /><span>Preview unavailable</span></div>;
  }

  return <span className="block h-24 overflow-hidden rounded-xl"><Image className="min-h-full object-cover" src={url} alt={alt} width={260} height={96} style={{ width: "100%", height: "auto" }} unoptimized onError={() => setFailed(true)} /></span>;
}

export function ExpenseDetailsPageClient({ expenseId }: { readonly expenseId: string }) {
  const runtime = useApplicationRuntime();
  const router = useRouter();
  const [view, setView] = useState<ExpenseView>();
  const [members, setMembers] = useState<readonly ExpenseMemberView[]>([]);
  const [receipts, setReceipts] = useState<readonly ReceiptPreview[]>([]);
  const [activity, setActivity] = useState<readonly ExpenseActivityView[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
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
    <PageContainer>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:gap-4">
        <Button asChild variant="ghost" className="-ml-3 h-9 rounded-xl"><Link href="/expenses"><ArrowLeft /> Back to expenses</Link></Button>
        <div className="flex items-center gap-3">{view.permissions.canEdit ? <Link aria-label="Edit" className="inline-flex h-11 w-40 items-center justify-center gap-2 rounded-xl border border-border-strong bg-card text-sm font-medium shadow-[var(--shadow-small)] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30" href={`/expenses/${expense.expenseId}/edit`}><Pencil aria-hidden="true" className="size-4" /> Edit Expense</Link> : null}{view.permissions.canDelete ? <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label="More expense actions" className="w-[66px] rounded-xl" variant="outline"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="text-danger focus:bg-danger-soft" onSelect={() => setDeleteDialogOpen(true)}><Trash2 aria-hidden="true" className="size-4" />Delete Expense</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</div>
      </div>
      {view.permissions.canDelete ? <ConfirmDialog destructive open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} title="Delete this expense?" description="The expense will leave normal lists and balances, while its audit history and receipts remain retained." confirmLabel="Delete Expense" onConfirm={async () => { await expenseActions.deleteExpense(expense.expenseId); router.push("/expenses"); }} /> : null}
      <header className="mt-1.5">
        <h1 className="page-title">{expense.name}</h1>
        <p className="financial-numerals mt-1 text-[22px] font-semibold leading-7">{formatBdt(expense.amount)}</p>
        <p className="compact-caption mt-1 text-text-muted">{formatExpenseDate(expense.expenseDate)} · {expense.deletedAt ? "Deleted historical expense · read-only" : "Household expense"}</p>
      </header>
      {expense.deletedAt ? <div className="mt-4 rounded-xl border border-danger/20 bg-danger-soft p-4 font-medium text-danger" role="status">Deleted</div> : null}
      {view.financialEditState === "former-member-frozen" ? <div className="mt-4 rounded-xl bg-warning-soft p-4 text-sm" role="status">Financial history is frozen because this expense involves a former member.</div> : null}
      {view.financialEditState === "legacy-percentage-input-unavailable" ? <div className="mt-4 rounded-xl bg-warning-soft p-4 text-sm" role="status">Original percentage inputs were not stored. Saved poisha shares remain effective; no percentages are invented.</div> : null}

      <div className="expense-details-grid mt-12 grid gap-6">
        <div className="grid content-start gap-[18px]">
          <Surface className="expense-overview-panel" padding="canonical">
            <h2 className="panel-title">Overview</h2>
            <div className="mt-6 grid gap-x-6 gap-y-8 sm:grid-cols-2"><div className="flex gap-3"><CalendarDays className="mt-0.5 size-4 text-text-muted" /><div><p className="table-label text-text-secondary">Expense Date</p><p className="mt-1 text-sm font-medium">{formatExpenseDate(expense.expenseDate)}</p></div></div><div className="flex gap-3"><UserRound className="mt-0.5 size-4 text-text-muted" /><div><p className="table-label text-text-secondary">Paid By</p><p className="mt-1 text-sm font-medium">{expense.payerId === runtime.session.userId ? "You" : payer?.displayName ?? "Unknown member"}{payer?.status === "former" ? " (Former member)" : ""}</p></div></div><div className="flex gap-3"><CreditCard className="mt-0.5 size-4 text-text-muted" /><div><p className="table-label text-text-secondary">Payment Method</p><p className="mt-1 text-sm font-medium capitalize">{expense.payment.method}</p></div></div><div><p className="table-label text-text-secondary">Split Method</p><p className="mt-1 text-sm font-medium capitalize">{splitLabel}</p></div></div>
          </Surface>

          {view.privateCardSnapshot && privateCardPalette ? <Surface className="private-payment-panel" padding="canonical"><h2 className="panel-title">Private Payment Detail</h2><div className="mt-4 flex items-center gap-3"><span aria-hidden="true" className="size-8 rounded-xl border border-black/10" style={{ backgroundColor: privateCardPalette.hex }} /><div><p className="text-sm font-semibold">{view.privateCardSnapshot.cardName}</p><p className="compact-caption mt-0.5 text-text-muted">{view.privateCardSnapshot.cardType} · {privateCardPalette.label} · Only visible to you</p></div></div></Surface> : null}

          <Surface className="expense-split-details-panel" padding="canonical"><h2 className="panel-title">Split Details</h2><ul className="mt-4 divide-y">{expense.allocations.map((allocation) => { const member = memberById.get(allocation.participantId); const source = expense.percentageEntries?.find((entry) => entry.participantId === allocation.participantId); return <li key={allocation.participantId} className="flex min-h-[54px] items-center justify-between gap-4"><div><p className="text-sm font-medium">{allocation.participantId === runtime.session.userId ? "You" : member?.displayName ?? "Unknown member"}</p><p className="compact-caption text-text-muted">{member?.status === "former" ? "Former member" : "Household member"}{source ? ` · ${formatBasisPoints(source.basisPoints)}%` : ""}</p></div><span className="financial-numerals text-sm font-semibold">{formatBdt(allocation.share)}</span></li>; })}</ul></Surface>

        </div>

        <aside className="grid content-start gap-[18px]">
          <Surface className="expense-detail-summary-panel" elevation="card" padding="canonical"><h2 className="panel-title">Summary</h2><dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between"><dt className="text-text-secondary">Total</dt><dd className="financial-numerals text-lg font-semibold">{formatBdt(expense.amount)}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Participants</dt><dd>{expense.allocations.length}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Payment</dt><dd className="capitalize">{expense.payment.method}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Split</dt><dd className="capitalize">{expense.splitMethod}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Status</dt><dd>{expense.deletedAt ? "Deleted" : "Active"}</dd></div></dl></Surface>
          <Surface className="expense-receipts-panel overflow-y-auto" padding="canonical"><div className="flex items-center gap-2"><ReceiptText aria-hidden="true" className="size-4" /><h2 className="panel-title">Receipts</h2></div>{receipts.length === 0 ? <p className="mt-4 text-sm text-text-secondary">No receipts attached.</p> : <div className="mt-3 grid gap-3">{receipts.map(({ metadata, url, error }) => <div key={metadata.receiptId} className="rounded-xl border p-3">{url ? <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${metadata.originalFilename ?? "receipt"}`}><ReceiptPreviewImage url={url} alt={metadata.originalFilename ?? "Expense receipt"} /></a> : <div className="flex h-24 items-center justify-center rounded-xl bg-secondary text-xs text-text-secondary">{error ? "Preview unavailable" : "Loading preview"}</div>}<div className="mt-2 flex items-center justify-between gap-2"><p className="min-w-0 truncate text-xs">{metadata.originalFilename ?? "Receipt image"}</p>{view.permissions.canEdit ? <ConfirmDialog destructive title="Remove this receipt?" description="Its metadata tombstone will remain for audit, while the local image Blob is removed." confirmLabel="Remove Receipt" trigger={<Button aria-label={`Remove ${metadata.originalFilename ?? "receipt"}`} size="icon-xs" variant="ghost"><Trash2 /></Button>} onConfirm={async () => { await expenseActions.deleteReceipt(metadata.receiptId); await load(); }} /> : null}</div></div>)}</div>}</Surface>
          <Surface className="expense-activity-panel overflow-y-auto" padding="canonical"><h2 className="panel-title">Activity</h2>{activity.length === 0 ? <p className="mt-4 text-sm text-text-secondary">No supported activity information.</p> : <ol className="mt-3 space-y-2">{activity.map((item, index) => <li key={`${item.occurredAt}-${index}`} className="rounded-xl bg-secondary p-3"><p className="text-xs font-medium capitalize">{item.action.replaceAll("-", " ")}</p><p className="compact-caption mt-1 text-text-secondary">{item.actorName} · {new Date(item.occurredAt).toLocaleString()}</p><p className="compact-caption text-text-secondary">Changed: {item.changedFields.join(", ")}</p></li>)}</ol>}</Surface>
        </aside>
      </div>
    </PageContainer>
  );
}
