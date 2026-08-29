"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Clock3, HandCoins, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import type {
  PendingSettlementView,
  SettlementHistoryView,
  SettlementPageView,
  SettlementRecommendationView,
} from "@/application/settlements/settlement-page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/presentation/components/confirm-dialog";
import { MetricCard } from "@/presentation/components/metric-card";
import { StatusBadge, type StatusTone } from "@/presentation/components/status-badge";
import { Surface } from "@/presentation/components/surface";
import { userErrorMessage } from "@/presentation/errors/user-error-message";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { MoneyValue } from "@/presentation/finance/money-value";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { CapabilityNotice, useCapability } from "@/presentation/runtime/capability-gate.client";
import { useIdempotentCommand } from "@/presentation/runtime/use-idempotent-command";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { PendingConfirmDialog } from "./pending-confirm-dialog";

const instantFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatInstant(value: string): string {
  return instantFormatter.format(new Date(value));
}

function statusTone(status: SettlementHistoryView["status"]): StatusTone {
  if (status === "confirmed") return "success";
  if (status === "rejected") return "danger";
  return "neutral";
}

function statusLabel(status: SettlementHistoryView["status"]): string {
  return status[0].toUpperCase() + status.slice(1);
}

interface RecommendationCardProps {
  readonly item: SettlementRecommendationView;
  readonly markPaid: () => Promise<void>;
  readonly actionsDisabled?: boolean;
}

function RecommendationCard({ item, markPaid, actionsDisabled = false }: RecommendationCardProps) {
  const outgoing = item.direction === "outgoing";
  return (
    <li>
      <Surface className="flex h-full flex-col gap-4" padding="small">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-foreground">
              {outgoing ? `You owe ${item.counterparty.displayName}` : `${item.counterparty.displayName} owes you`}
            </p>
            {item.counterparty.former ? <p className="text-caption text-text-muted">Former member</p> : null}
          </div>
          <HandCoins aria-hidden="true" className="size-5 text-text-muted" />
        </div>
        <MoneyValue className="text-h2 font-semibold" value={item.recommendation.amount} />
        {outgoing && item.canMarkPaid ? (
          <>
            <ConfirmDialog
              confirmLabel="Mark as Paid"
              description={<span>House Finance Tracker does not transfer money. Confirm that you paid {item.counterparty.displayName} <span className="financial-numerals font-semibold">{formatBdt(item.recommendation.amount)}</span> outside the application.</span>}
              onConfirm={markPaid}
              title={`Settle up with ${item.counterparty.displayName}?`}
              trigger={(
                <Button
                  aria-label={`Settle up with ${item.counterparty.displayName} for ${formatBdt(item.recommendation.amount)}`}
                  className="mt-auto w-full sm:w-auto sm:self-start"
                  disabled={actionsDisabled}
                >
                  Settle Up
                </Button>
              )}
            />
            <CapabilityNotice active={actionsDisabled} />
          </>
        ) : null}
        {item.blockedReason ? (
          <p className="mt-auto rounded-lg bg-warning-soft p-3 text-sm text-foreground">
            {item.blockedReason}
          </p>
        ) : null}
        {!outgoing ? <p className="mt-auto text-sm text-text-secondary">They can mark the external payment as paid.</p> : null}
      </Surface>
    </li>
  );
}

interface PendingCardProps {
  readonly item: PendingSettlementView;
  readonly loadPreview: () => Promise<PendingSettlementView>;
  readonly confirm: () => Promise<void>;
  readonly reject: () => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly actionsDisabled?: boolean;
}

function PendingCard({ item, loadPreview, confirm, reject, cancel, actionsDisabled = false }: PendingCardProps) {
  const receiving = item.relationship === "receiver";
  return (
    <li>
      <Surface className="space-y-4" padding="small">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium text-foreground">
              {receiving
                ? `${item.sender.displayName} says they paid you`
                : `You marked ${formatBdt(item.amount)} as paid to ${item.receiver.displayName}`}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {receiving
                ? "Did you receive this payment?"
                : `Waiting for ${item.receiver.displayName} to confirm.`}
            </p>
          </div>
          <StatusBadge className="text-foreground" tone="info">Pending</StatusBadge>
        </div>
        <MoneyValue className="text-h2 font-semibold" value={item.amount} />
        {item.warning ? (
          <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-foreground">
            <p className="font-medium">{item.warning.heading}</p>
            <p className="mt-1">{item.warning.detail} The original amount is <MoneyValue className="font-semibold" value={item.amount} />.</p>
          </div>
        ) : null}
        <p className="flex items-center gap-2 text-caption text-text-secondary">
          <Clock3 aria-hidden="true" className="size-4" />
          Recorded <time dateTime={item.createdAt}>{formatInstant(item.createdAt)}</time>
        </p>
        {receiving ? (
          <div className="grid gap-2 sm:flex sm:justify-end">
            <ConfirmDialog
              confirmLabel="Reject Payment"
              destructive
              description={<span>Reject {item.sender.displayName}&apos;s claim that they paid <span className="financial-numerals font-semibold">{formatBdt(item.amount)}</span>? The claim will remain in Settlement History and will not affect balances.</span>}
              onConfirm={reject}
              title="Reject this payment claim?"
              trigger={<Button className="w-full sm:w-auto" disabled={actionsDisabled} variant="outline">Reject</Button>}
            />
            <PendingConfirmDialog settlement={item} loadPreview={loadPreview} onConfirm={confirm} disabled={actionsDisabled} />
          </div>
        ) : (
          <ConfirmDialog
            confirmLabel="Cancel Claim"
            destructive
            description={<span>Cancel your <span className="financial-numerals font-semibold">{formatBdt(item.amount)}</span> payment claim to {item.receiver.displayName}? It will remain in Settlement History and will not affect balances.</span>}
            onConfirm={cancel}
            title="Cancel this payment claim?"
            trigger={<Button className="w-full sm:w-auto" disabled={actionsDisabled} variant="outline">Cancel Claim</Button>}
          />
        )}
        {receiving ? null : <CapabilityNotice active={actionsDisabled} />}
      </Surface>
    </li>
  );
}

function History({ items }: { readonly items: readonly SettlementHistoryView[] }) {
  if (items.length === 0) {
    return <Surface><p className="text-text-secondary">No completed settlement history yet.</p></Surface>;
  }
  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left">
          <thead className="border-b bg-secondary text-label text-text-secondary">
            <tr><th className="px-5 py-3 font-medium">Payment</th><th className="px-5 py-3 font-medium" scope="col">Amount</th><th className="px-5 py-3 font-medium" scope="col">Status</th><th className="px-5 py-3 font-medium" scope="col">Created</th><th className="px-5 py-3 font-medium" scope="col">Resolved</th></tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => (
              <tr key={item.settlementId}>
                <td className="px-5 py-4 font-medium">{item.sender.displayName}<span className="sr-only"> paid </span> <ArrowRight aria-hidden="true" className="mx-1 inline size-4" /> {item.receiver.displayName}</td>
                <td className="px-5 py-4"><MoneyValue className="font-semibold" value={item.amount} /></td>
                <td className="px-5 py-4"><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></td>
                <td className="px-5 py-4 text-sm text-text-secondary"><time dateTime={item.createdAt}>{formatInstant(item.createdAt)}</time></td>
                <td className="px-5 py-4 text-sm text-text-secondary"><time dateTime={item.resolvedAt}>{formatInstant(item.resolvedAt)}</time></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y md:hidden">
        {items.map((item) => (
          <li className="space-y-3 p-4" key={item.settlementId}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{item.sender.displayName}<span className="sr-only"> paid </span> <ArrowRight aria-hidden="true" className="mx-1 inline size-4" /> {item.receiver.displayName}</p>
              <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge>
            </div>
            <MoneyValue className="text-xl font-semibold" value={item.amount} />
            <div className="grid gap-1 text-caption text-text-secondary">
              <p>Created <time dateTime={item.createdAt}>{formatInstant(item.createdAt)}</time></p>
              <p>Resolved <time dateTime={item.resolvedAt}>{formatInstant(item.resolvedAt)}</time></p>
            </div>
          </li>
        ))}
      </ul>
    </Surface>
  );
}

export function SettlementsPageClient() {
  const runtime = useApplicationRuntime();
  const [view, setView] = useState<SettlementPageView>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [feedback, setFeedback] = useState("");
  const pendingCommand = useIdempotentCommand();

  const household = runtime.status === "ready" &&
    (runtime.household.status === "active-member" || runtime.household.status === "active-leader")
    ? runtime.household.household
    : undefined;
  const settlementActions = runtime.status === "ready" ? runtime.settlementActions : undefined;
  const settlementMutationsEnabled = useCapability("settlementMutations");
  const currentUserId = runtime.status === "ready" ? runtime.session.userId : undefined;
  const householdId = household?.householdId;

  useEffect(() => {
    if (!settlementActions || !householdId) return;
    let active = true;
    void settlementActions.getPage(householdId)
      .then((nextView) => {
        if (!active) return;
        setView(nextView);
        setStatus("ready");
      })
      .catch(() => active && setStatus("error"));
    return () => { active = false; };
  }, [currentUserId, householdId, settlementActions]);

  async function refresh() {
    if (!settlementActions || !householdId) return;
    setView(await settlementActions.getPage(householdId));
    setStatus("ready");
  }

  async function mutate(action: () => Promise<void>, success: string) {
    try {
      await action();
      setFeedback(success);
      toast.success(success);
      await refresh();
    } catch (error) {
      const message = userErrorMessage(error, "The settlement action could not be completed.");
      setFeedback(message);
      toast.error(message);
      throw error;
    }
  }

  if (status === "loading" && !view) {
    return <PageContainer><Surface><p role="status" className="text-text-secondary">Loading settlements…</p></Surface></PageContainer>;
  }

  if (status === "error" && !view) {
    return (
      <PageContainer>
        <Surface className="space-y-4 text-center">
          <p role="alert" className="text-danger">Settlements could not be loaded.</p>
          <Button onClick={() => { setStatus("loading"); void refresh(); }} variant="outline">Try again</Button>
        </Surface>
      </PageContainer>
    );
  }

  if (!view || runtime.status !== "ready") return null;

  return (
    <PageContainer className="space-y-6">
      <PageHeader title="Settlements" description="Review your current position and record payments made outside House Finance Tracker." />
      <p aria-live="polite" className="sr-only" role="status">{feedback}</p>

      <section aria-labelledby="settlement-summary-heading" className="space-y-4">
        <h2 className="sr-only" id="settlement-summary-heading">Current financial position</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard label="You Owe" value={<MoneyValue aria-label="You Owe amount" value={view.summary.youOwe} />} />
          <MetricCard label="You Are Owed" value={<MoneyValue aria-label="You Are Owed amount" value={view.summary.youAreOwed} />} />
        </div>
      </section>

      <section aria-labelledby="settle-up-heading" className="space-y-4">
        <div><h2 className="panel-title" id="settle-up-heading">Settle Up</h2><p className="compact-caption mt-1 text-text-muted">Current recommendations are derived from household history.</p></div>
        {view.recommendations.length === 0 ? (
          <Surface className="py-10 text-center">
            <ReceiptText aria-hidden="true" className="mx-auto size-8 text-success" />
            <h3 className="panel-title mt-3">You&apos;re all settled.</h3>
            <p className="mt-2 text-text-secondary">Nobody currently owes anything.</p>
          </Surface>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {view.recommendations.map((item) => (
              <RecommendationCard
                actionsDisabled={!settlementMutationsEnabled}
                item={item}
                key={`${item.recommendation.senderId}:${item.recommendation.receiverId}`}
                markPaid={() => mutate(
                  async () => {
                    await runtime.settlementActions.markRecommendationPaid(item.recommendation, pendingCommand.forIntent(JSON.stringify(item.recommendation)));
                    pendingCommand.complete();
                  },
                  `Payment to ${item.counterparty.displayName} marked as Pending.`,
                )}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pending-heading" className="space-y-4">
        <div><h2 className="panel-title" id="pending-heading">Pending</h2><p className="compact-caption mt-1 text-text-muted">Payments waiting for confirmation or cancellation.</p></div>
        {view.pending.length === 0 ? <Surface><p className="text-text-secondary">No Pending payments involve you.</p></Surface> : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {view.pending.map((item) => (
              <PendingCard
                actionsDisabled={!settlementMutationsEnabled}
                item={item}
                key={item.settlementId}
                loadPreview={() => runtime.settlementActions.getPendingPreview(item.settlementId)}
                confirm={() => mutate(() => runtime.settlementActions.confirm(item.settlementId), "Payment confirmed and balances refreshed.")}
                reject={() => mutate(() => runtime.settlementActions.reject(item.settlementId), "Payment claim rejected.")}
                cancel={() => mutate(() => runtime.settlementActions.cancel(item.settlementId), "Payment claim cancelled.")}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-heading" className="space-y-4">
        <div><h2 className="panel-title" id="history-heading">History</h2><p className="compact-caption mt-1 text-text-muted">Completed household settlement records.</p></div>
        <History items={view.history} />
      </section>
    </PageContainer>
  );
}
