"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, CreditCard, ImageOff, Loader2, MoreHorizontal, Paperclip, Pencil, ReceiptText, Send, Trash2, UserRound } from "lucide-react";

import type {
  ExpenseActivityView,
  ExpenseMemberView,
  PrivateReceiptView,
  ReceiptView,
  ExpenseView,
  ExpenseCommentView,
} from "@/application/services/application-services";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { expenseId as parseExpenseId } from "@/domain/shared/identifiers";
import { DomainError } from "@/domain/shared/domain-error";
import { ConfirmDialog } from "@/presentation/components/confirm-dialog";
import { Surface } from "@/presentation/components/surface";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { CapabilityNotice, useCapability } from "@/presentation/runtime/capability-gate.client";
import { PageContainer } from "@/presentation/shell/page-container";
import { getCardPaletteOption } from "@/presentation/cards/card-palette";
import { formatBasisPoints, formatExpenseDate, formatReceiptCreatedAt, receiptContentStateText, RECEIPT_RETENTION_NOTICE } from "./expense-ui";
import { createTrackedReceiptPreviewUrl } from "./receipt-preview-url";
import { ExpenseSemanticIcon } from "./expense-icon";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { useIdempotentCommand } from "@/presentation/runtime/use-idempotent-command";

interface ReceiptPreview {
  readonly metadata: ReceiptView;
  readonly url?: string;
  readonly error?: boolean;
  readonly contentPending?: boolean;
}

function ReceiptHistoricalState({ receipt }: Readonly<{ receipt: PrivateReceiptView }>) {
  const state = receiptContentStateText(receipt.contentStatus);
  return <div className="flex min-h-16 flex-col items-center justify-center rounded-xl bg-secondary px-3 text-center"><ImageOff aria-hidden="true" className="mb-1 size-5 text-text-muted" /><p className="text-xs font-medium">{state.title}</p>{state.description ? <p className="compact-caption mt-1 text-text-muted">{state.description}</p> : null}</div>;
}

function ReceiptPreviewImage({ url, alt }: Readonly<{ url: string; alt: string }>) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl bg-secondary text-xs text-text-secondary"><ImageOff aria-hidden="true" className="size-5" /><span>Preview unavailable</span></div>;
  }

  return <span className="relative block h-16 overflow-hidden rounded-xl"><Image className="object-cover" src={url} alt={alt} fill sizes="260px" unoptimized onError={() => setFailed(true)} /></span>;
}

export function ExpenseDetailsPageClient({ expenseId }: { readonly expenseId: string }) {
  const runtime = useApplicationRuntime();
  const expenseMutationsEnabled = useCapability("expenseMutations");
  const receiptMutationsEnabled = useCapability("receiptMutations");
  const router = useRouter();
  const [view, setView] = useState<ExpenseView>();
  const [members, setMembers] = useState<readonly ExpenseMemberView[]>([]);
  const [receipts, setReceipts] = useState<readonly ReceiptPreview[]>([]);
  const [activity, setActivity] = useState<readonly ExpenseActivityView[]>([]);
  const [comments, setComments] = useState<readonly ExpenseCommentView[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentError, setCommentError] = useState<string>();
  const [commentSaving, setCommentSaving] = useState(false);
  const commentCommand = useIdempotentCommand();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const urlsRef = useRef<string[]>([]);
  const loadVersionRef = useRef(0);

  const household = runtime.status === "ready" &&
    (runtime.household.status === "active-member" || runtime.household.status === "active-leader")
    ? runtime.household.household
    : undefined;

  const load = useCallback(async () => {
    if (runtime.status !== "ready" || !household) return;
    const loadVersion = ++loadVersionRef.current;
    const isCurrent = () => loadVersionRef.current === loadVersion;
    const id = parseExpenseId(expenseId);
    const [nextView, nextMembers, metadata, nextActivity, nextComments] = await Promise.all([
      runtime.expenseActions.getExpense(id),
      runtime.expenseActions.listMembers(household.householdId),
      runtime.expenseActions.listReceipts(id),
      runtime.expenseActions.listActivity(id),
      runtime.expenseActions.listComments?.(id) ?? Promise.resolve([]),
    ]);
    if (!isCurrent()) return;
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
    const contentReadsEnabled = runtime.capabilities.receiptContentReads;
    const nextReceipts = await Promise.all(metadata.map(async (receipt): Promise<ReceiptPreview | undefined> => {
      if (receipt.visibility === "attachment") {
        return { metadata: receipt };
      }
      if (!contentReadsEnabled) {
        return {
          metadata: receipt,
          ...(receipt.canRead && receipt.contentStatus === "available" ? { contentPending: true } : {}),
        };
      }
      if (!receipt.canRead || receipt.contentStatus !== "available") {
        return { metadata: receipt };
      }
      try {
        const url = await createTrackedReceiptPreviewUrl(
          () => runtime.expenseActions.readReceipt(receipt.receiptId),
          isCurrent,
          (nextUrl) => urlsRef.current.push(nextUrl),
        );
        return url ? { metadata: receipt, url } : undefined;
      } catch {
        return isCurrent() ? { metadata: receipt, error: true } : undefined;
      }
    }));
    const completeReceipts = nextReceipts.filter(
      (receipt): receipt is ReceiptPreview => receipt !== undefined,
    );
    if (!isCurrent() || completeReceipts.length !== nextReceipts.length) return;
    setView(nextView);
    setMembers(nextMembers);
    setReceipts(completeReceipts);
    setActivity(nextActivity);
    setComments(nextComments);
    setStatus("ready");
  }, [expenseId, household, runtime]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load().catch(() => setStatus("error"));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => () => {
    loadVersionRef.current += 1;
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
  }, []);

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
  const financiallyLocked = view.financialEditability.state === "locked";

  async function deleteExpense() {
    try {
      await expenseActions.deleteExpense(expense.expenseId, expense.revision);
      router.push("/expenses");
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === "EXPENSE_FINANCIAL_HISTORY_LOCKED"
      ) {
        await load();
        return;
      }
      throw error;
    }
  }

  async function sendComment() {
    if (!expenseActions.createComment || commentSaving) return;
    const body = commentBody.trim();
    if (!body) { setCommentError("Write a comment before sending."); return; }
    if (body.length > 1000) { setCommentError("Comment must be 1000 characters or fewer."); return; }
    setCommentSaving(true);
    setCommentError(undefined);
    try {
      const created = await expenseActions.createComment(expense.expenseId, body, commentCommand.forIntent(JSON.stringify({ expenseId: expense.expenseId, body })));
      commentCommand.complete();
      setComments((current) => [...current, created]);
      setCommentBody("");
      setView((current) => current ? { ...current, commentCount: (current.commentCount ?? comments.length) + 1 } : current);
    } catch {
      setCommentError("Comment could not be sent. Try again.");
    } finally { setCommentSaving(false); }
  }

  return (
    <PageContainer>
      <Button asChild variant="ghost" className="-ml-3 min-h-11 rounded-xl lg:min-h-9"><Link href="/expenses"><ArrowLeft /> Back to expenses</Link></Button>
      {view.permissions.canDelete ? <ConfirmDialog destructive open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen} title="Delete this expense?" description="The expense will leave normal lists and balances. Financial history and receipt metadata remain, while receipt files continue under the normal retention period." confirmLabel="Delete Expense" onConfirm={deleteExpense} /> : null}
      <header className="mt-1.5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft"><ExpenseSemanticIcon category={expense.iconCategory} className="size-5" /></span><h1 className="page-title break-words">{expense.name}</h1></div>
          <p className="financial-numerals mt-1 text-xl font-semibold leading-7">{formatBdt(expense.amount)}</p>
          <p className="compact-caption mt-1 text-text-muted">{formatExpenseDate(expense.expenseDate)} · {expense.deletedAt ? "Deleted historical expense · read-only" : "Household expense"}</p>
          {view.addedAfterSettlement ? <p className="compact-caption mt-1 text-text-muted">Added after settlement</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">{view.permissions.canEdit ? (expenseMutationsEnabled ? <Link aria-label="Edit" className="inline-flex h-11 w-40 items-center justify-center gap-2 rounded-xl border border-border-strong bg-card text-sm font-medium shadow-[var(--shadow-small)] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30" href={`/expenses/${expense.expenseId}/edit`}><Pencil aria-hidden="true" className="size-4" /> Edit Expense</Link> : <span aria-disabled className="inline-flex h-11 w-40 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-border-strong bg-card text-sm font-medium text-text-muted opacity-60" data-capability-pending title="This action arrives with the next production update."><Pencil aria-hidden="true" className="size-4" /> Edit Expense</span>) : null}{view.permissions.canDelete ? <DropdownMenu><DropdownMenuTrigger asChild disabled={!expenseMutationsEnabled}><Button aria-label="More expense actions" className="w-[66px] rounded-xl" variant="outline"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="text-danger focus:bg-danger-soft" onSelect={() => setDeleteDialogOpen(true)}><Trash2 aria-hidden="true" className="size-4" />Delete Expense</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</div>
      </header>
      {(!expenseMutationsEnabled || !receiptMutationsEnabled) && (view.permissions.canEdit || view.permissions.canDelete) ? <CapabilityNotice active /> : null}
      {expense.deletedAt ? <div className="mt-4 rounded-xl border border-danger/20 bg-danger-soft p-4 font-medium text-danger" role="status">Deleted</div> : null}
      {financiallyLocked ? <div className="mt-4 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm" role="status"><p className="font-semibold">{view.financialEditability.title}</p><p className="mt-1">{view.financialEditability.description}</p>{view.financialEditability.deleteDescription ? <p className="mt-1 text-text-secondary">{view.financialEditability.deleteDescription}</p> : null}</div> : null}

      <div className="expense-details-grid mt-12 grid gap-6">
        <div className="grid content-start gap-4">
          <Surface className="expense-overview-panel" padding="canonical">
            <h2 className="panel-title">Overview</h2>
            <div className="mt-6 grid gap-x-6 gap-y-8 sm:grid-cols-2"><div className="flex gap-3"><CalendarDays className="mt-0.5 size-4 text-text-muted" /><div><p className="table-label text-text-secondary">Expense Date</p><p className="mt-1 text-sm font-medium">{formatExpenseDate(expense.expenseDate)}</p></div></div><div className="flex gap-3"><UserRound className="mt-0.5 size-4 text-text-muted" /><div><p className="table-label text-text-secondary">Paid By</p><p className="mt-1 text-sm font-medium">{expense.payerId === runtime.session.userId ? "You" : payer?.displayName ?? "Unknown member"}{payer?.status === "former" ? " (Former member)" : ""}</p></div></div><div className="flex gap-3"><CreditCard className="mt-0.5 size-4 text-text-muted" /><div><p className="table-label text-text-secondary">Payment Method</p><p className="mt-1 text-sm font-medium capitalize">{expense.payment.method}</p></div></div><div><p className="table-label text-text-secondary">Split Method</p><p className="mt-1 text-sm font-medium capitalize">{splitLabel}</p></div></div>
          </Surface>

          {view.privateCardSnapshot && privateCardPalette ? <Surface className="private-payment-panel" padding="canonical"><h2 className="panel-title">Private Payment Detail</h2><div className="mt-4 flex items-center gap-3"><span aria-hidden="true" className="size-8 rounded-xl border border-black/10" style={{ backgroundColor: privateCardPalette.hex }} /><div><p className="text-sm font-semibold">{view.privateCardSnapshot.cardName}</p><p className="compact-caption mt-0.5 text-text-muted">{view.privateCardSnapshot.cardType} · {privateCardPalette.label} · Only visible to you</p></div></div></Surface> : null}

          <Surface className="expense-split-details-panel" padding="canonical"><h2 className="panel-title">Split Details</h2><ul className="mt-4 divide-y">{expense.allocations.map((allocation) => { const member = memberById.get(allocation.participantId); const source = expense.percentageEntries?.find((entry) => entry.participantId === allocation.participantId); return <li key={allocation.participantId} className="flex min-h-[54px] items-center justify-between gap-4"><div><p className="text-sm font-medium">{allocation.participantId === runtime.session.userId ? "You" : member?.displayName ?? "Unknown member"}</p><p className="compact-caption text-text-muted">{member?.status === "former" ? "Former member" : "Household member"}{source ? ` · ${formatBasisPoints(source.basisPoints)}%` : ""}</p></div><span className="financial-numerals text-sm font-semibold">{formatBdt(allocation.share)}</span></li>; })}</ul></Surface>

        </div>

        <aside aria-label="Expense supporting information" className="grid content-start gap-4">
          <Surface className="expense-detail-summary-panel" elevation="card" padding="canonical"><h2 className="panel-title">Summary</h2><dl className="mt-5 space-y-4 text-sm"><div className="flex justify-between"><dt className="text-text-secondary">Total</dt><dd className="financial-numerals text-lg font-semibold">{formatBdt(expense.amount)}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Participants</dt><dd>{expense.allocations.length}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Payment</dt><dd className="capitalize">{expense.payment.method}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Split</dt><dd className="capitalize">{expense.splitMethod}</dd></div><div className="flex justify-between"><dt className="text-text-secondary">Status</dt><dd>{expense.deletedAt ? "Deleted" : financiallyLocked ? "Financially locked" : "Active"}</dd></div></dl></Surface>
          <Surface className="expense-receipts-panel overflow-y-auto" padding="canonical"><div className="flex items-center gap-2"><ReceiptText aria-hidden="true" className="size-4" /><h2 className="panel-title">Receipts</h2></div><p className="compact-caption mt-1 text-text-muted">{RECEIPT_RETENTION_NOTICE}</p>{receipts.length === 0 ? <p className="mt-4 text-sm text-text-secondary">No receipts attached.</p> : <div className="mt-3 grid gap-3">{receipts.map(({ metadata, url, error, contentPending }, index) => metadata.visibility === "attachment" ? <div key={`private-attachment-${index}`} className="rounded-xl border bg-secondary p-4"><p className="text-sm font-medium">Receipt attached</p><p className="compact-caption mt-1 text-text-muted">Receipt details are private to its creator and historical uploader.</p></div> : <div key={metadata.receiptId} className="rounded-xl border p-3">{metadata.contentStatus !== "available" ? <ReceiptHistoricalState receipt={metadata} /> : contentPending ? <div className="flex h-16 flex-col items-center justify-center rounded-xl bg-secondary px-3 text-center text-xs text-text-secondary"><Paperclip aria-hidden="true" className="mb-1 size-5 text-text-muted" /><p>Preview arrives with receipt storage in a later update.</p></div> : url ? <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${metadata.originalFilename ?? "receipt"}`}><ReceiptPreviewImage url={url} alt={metadata.originalFilename ?? "Expense receipt"} /></a> : <div className="flex h-16 items-center justify-center rounded-xl bg-secondary text-xs text-text-secondary">{error ? "Preview unavailable" : "Loading preview"}</div>}<div className="mt-2 flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs">{metadata.originalFilename ?? "Receipt image"}</p><p className="compact-caption text-text-muted">Uploaded {formatReceiptCreatedAt(metadata.createdAt)}</p></div>{metadata.canRemove ? <ConfirmDialog destructive title="Remove this receipt?" description="The receipt file will be removed immediately. Its metadata remains as user-deleted history." confirmLabel="Remove Receipt" trigger={<Button aria-label={`Remove ${metadata.originalFilename ?? "receipt"}`} className="size-11" disabled={!receiptMutationsEnabled} size="icon" variant="ghost"><Trash2 /></Button>} onConfirm={async () => { await expenseActions.deleteReceipt(metadata.receiptId); await load(); }} /> : null}</div></div>)}</div>}</Surface>
          <Surface className="expense-activity-panel overflow-y-auto" padding="canonical"><h2 className="panel-title">Activity</h2>{activity.length === 0 ? <p className="mt-4 text-sm text-text-secondary">No supported activity information.</p> : <ol className="mt-3 space-y-2">{activity.map((item, index) => <li key={`${item.occurredAt}-${index}`} className="rounded-xl bg-secondary p-3"><p className="text-xs font-medium capitalize">{item.action.replaceAll("-", " ")}</p><p className="compact-caption mt-1 text-text-secondary">{item.actorName} · {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.occurredAt))}</p><p className="compact-caption text-text-secondary">Changed: {item.changedFields.join(", ")}</p></li>)}</ol>}</Surface>
        </aside>
      </div>
      <Surface className="mt-6" padding="canonical">
        <h2 className="panel-title">Comments ({comments.length})</h2>
        {comments.length === 0 ? <p className="mt-4 text-sm text-text-secondary">No comments yet.</p> : <ol className="mt-4 divide-y">{comments.map((comment) => <li className="flex gap-3 py-4 first:pt-0" key={comment.commentId}><MemberAvatar className="size-9 shrink-0" displayName={comment.authorDisplayName} userId={comment.authorUserId} /><div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-2"><p className="text-sm font-semibold">{comment.authorDisplayName}</p><time className="compact-caption text-text-muted" dateTime={comment.createdAt}>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(comment.createdAt))}</time></div><p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-secondary">{comment.body}</p></div></li>)}</ol>}
        {!expense.deletedAt && expenseActions.createComment ? <div className="mt-5 border-t pt-5"><label className="text-label font-medium" htmlFor="expense-comment">Write a comment</label><textarea id="expense-comment" className="mt-2 min-h-28 w-full resize-y rounded-xl border border-input bg-card px-3 py-2 text-sm outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/30" maxLength={1000} aria-describedby="expense-comment-help expense-comment-error" value={commentBody} onChange={(event) => { setCommentBody(event.target.value); setCommentError(undefined); }} placeholder="Write a comment..." /><div className="mt-2 flex flex-wrap items-center justify-between gap-3"><p id="expense-comment-help" className="compact-caption text-text-muted">Plain text · {commentBody.length}/1000</p><Button type="button" disabled={commentSaving || commentBody.trim().length === 0} aria-busy={commentSaving} onClick={() => void sendComment()}>{commentSaving ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />} {commentSaving ? "Sending…" : "Send"}</Button></div>{commentError ? <p id="expense-comment-error" className="mt-2 text-sm text-danger" role="alert">{commentError}</p> : null}</div> : null}
      </Surface>
    </PageContainer>
  );
}
