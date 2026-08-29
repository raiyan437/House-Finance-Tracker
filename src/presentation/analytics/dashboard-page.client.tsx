"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Banknote, CircleCheck, CreditCard, LoaderCircle, Plus, Users, Wallet } from "lucide-react";
import type { DashboardPageView } from "@/application/analytics/analytics-page";
import { currentLocalCalendarMonth, formatCalendarMonth, type CalendarMonth } from "@/application/analytics/calendar-month";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/presentation/components/chart-card";
import { ErrorState, LoadingState } from "@/presentation/components/async-state";
import { CardEmptyState } from "@/presentation/components/empty-state";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { MetricCard } from "@/presentation/components/metric-card";
import { MobileCollapse } from "@/presentation/components/mobile-collapse";
import { Surface } from "@/presentation/components/surface";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import type { HouseholdId, UserId } from "@/domain/shared/identifiers";
import { PageContainer } from "@/presentation/shell/page-container";
import { DailySpendingChart, PaymentMixChart } from "./analytics-charts.client";
import { formatBasisPointPercentage, absolutePoisha } from "./analytics-ui";
import { ExpenseSummaryList } from "./expense-summary-list";
import { MonthSelector } from "./month-selector";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; requestKey: string }>
  | Readonly<{ status: "ready"; requestKey: string; view: DashboardPageView }>;

const sessionSelectedMonths = new Map<string, CalendarMonth>();

export function DashboardPageClient() {
  const runtime = useApplicationRuntime();
  const household = runtime.status === "ready" &&
    (runtime.household.status === "active-member" || runtime.household.status === "active-leader")
    ? runtime.household.household
    : undefined;

  if (runtime.status !== "ready" || !household) {
    return (
      <PageContainer className="space-y-5">
        <h1 className="sr-only">Dashboard</h1>
        <LoadingState label="Loading Dashboard" />
      </PageContainer>
    );
  }
  return (
    <DashboardAnalytics
      key={`${runtime.session.userId}:${household.householdId}`}
      sessionUserId={runtime.session.userId}
      householdId={household.householdId}
    />
  );
}

function DashboardAnalytics({ sessionUserId, householdId }: Readonly<{ sessionUserId: UserId; householdId: HouseholdId }>) {
  const runtime = useApplicationRuntime();
  const analyticsActions = runtime.status === "ready" ? runtime.analyticsActions : undefined;
  const selectionKey = `${sessionUserId}:${householdId}`;
  const [month, setMonthState] = useState<CalendarMonth>(
    () => sessionSelectedMonths.get(selectionKey) ?? currentLocalCalendarMonth(),
  );
  const setMonth = (next: CalendarMonth) => {
    sessionSelectedMonths.set(selectionKey, next);
    setMonthState(next);
  };
  const [reload, setReload] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const request = useRef(0);
  const requestKey = `${selectionKey}:${month}:${reload}`;
  const visibleState = loadState.status !== "loading" && loadState.requestKey === requestKey
    ? loadState
    : { status: "loading" as const };
  const staleView = visibleState.status === "loading" && loadState.status === "ready" ? loadState.view : undefined;

  useEffect(() => {
    if (!analyticsActions) return;
    const currentRequest = ++request.current;
    void analyticsActions.getDashboard(householdId, month)
      .then((view: DashboardPageView) => {
        if (request.current === currentRequest) setLoadState({ status: "ready", requestKey, view });
      })
      .catch(() => {
        if (request.current === currentRequest) setLoadState({ status: "error", requestKey });
      });
  }, [analyticsActions, householdId, month, requestKey]);

  return (
    <PageContainer className="space-y-5">
      <h1 className="sr-only">Dashboard</h1>
      <div className="flex min-h-11 flex-wrap items-center gap-4">
        <MonthSelector options={visibleState.status === "ready" ? visibleState.view.monthOptions : [month]} value={month} onChange={setMonth} />
        {visibleState.status === "ready" ? <MemberAvatars members={visibleState.view.members} /> : <div aria-hidden="true" className="h-10" />}
        {staleView ? (
          <span className="flex items-center gap-2 text-caption text-text-muted" role="status">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Updating {formatCalendarMonth(month)}
          </span>
        ) : null}
      </div>

      {visibleState.status === "loading" && !staleView ? <LoadingState label={`Loading ${formatCalendarMonth(month)} Dashboard analytics`} /> : null}
      {visibleState.status === "error" ? (
        <ErrorState
          description="Dashboard analytics could not be reconstructed from the household records. Your saved financial data was not changed."
          onRetry={() => setReload((value) => value + 1)}
          title="Dashboard unavailable"
        />
      ) : null}
      {staleView ? (
        <div aria-busy="true" className="pointer-events-none select-none space-y-5 opacity-50 transition-opacity motion-reduce:transition-none">
          <DashboardContent view={staleView} />
        </div>
      ) : null}
      {visibleState.status === "ready" ? <DashboardContent view={visibleState.view} /> : null}
    </PageContainer>
  );
}

function MemberAvatars({ members }: Pick<DashboardPageView, "members">) {
  const visible = members.slice(0, 5);
  const overflow = members.length - visible.length;
  return (
    <div aria-label={`Active household members: ${members.map((member) => member.displayName).join(", ")}`} className="flex min-h-11 items-center" role="group">
      <div aria-hidden="true" className="flex -space-x-1.5">
        {visible.map((member, index) => (
          <MemberAvatar
            className={`size-9 ring-2 ring-background ${index === 0 ? "[&_[data-slot=avatar-fallback]]:bg-[#282828] [&_[data-slot=avatar-fallback]]:text-white" : index === 1 ? "[&_[data-slot=avatar-fallback]]:bg-[#ddebff]" : index === 2 ? "[&_[data-slot=avatar-fallback]]:bg-[#e8e1ff]" : "[&_[data-slot=avatar-fallback]]:bg-[#cff4e2]"} [&_[data-slot=avatar-fallback]]:text-mini`}
            displayName={member.displayName}
            key={member.userId}
          />
        ))}
        {overflow > 0 ? <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold ring-2 ring-background">+{overflow}</span> : null}
      </div>
    </div>
  );
}

export function DashboardContent({ view }: Readonly<{ view: DashboardPageView }>) {
  const trendSummary = view.spent === 0
    ? `No spending in ${formatCalendarMonth(view.selectedMonth)}. All ${view.dailySpending.length} calendar days are represented with zero spending.`
    : `${formatBdt(view.spent)} spent across ${view.dailySpending.length} calendar days; zero-spending days remain included.`;
  const paymentSummary = view.paymentMix.total === 0
    ? `No spending in ${formatCalendarMonth(view.selectedMonth)}; Cash and Card are both ${formatBdt(view.paymentMix.total)}.`
    : `Cash ${formatBdt(view.paymentMix.cash.amount)} (${formatBasisPointPercentage(view.paymentMix.cash.basisPoints ?? 0)}); Card ${formatBdt(view.paymentMix.card.amount)} (${formatBasisPointPercentage(view.paymentMix.card.basisPoints ?? 0)}).`;
  return (
    <div>
      <div className="dashboard-summary-grid grid gap-4 md:grid-cols-2">
        <MetricCard className="min-h-36" label="Spent" value={<span className="financial-numerals metric-value motion-safe:animate-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300" key={formatBdt(view.spent)}>{formatBdt(view.spent)}</span>} supportingText={formatCalendarMonth(view.selectedMonth)} />
        <Surface className="min-h-36" padding="canonical">
          <h2 className="metric-label">Outstanding</h2>
          <div className="mt-5 grid grid-cols-2 divide-x">
            <div className="pr-5"><p className="compact-caption text-text-secondary">You Owe</p><p className="financial-numerals mt-1 text-stat font-semibold leading-7 text-danger"><span className="motion-safe:animate-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300" key={formatBdt(view.outstanding.youOwe)}>{formatBdt(view.outstanding.youOwe)}</span></p></div>
            <div className="pl-5"><p className="compact-caption text-text-secondary">You Are Owed</p><p className="financial-numerals mt-1 text-stat font-semibold leading-7 text-success"><span className="motion-safe:animate-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300" key={formatBdt(view.outstanding.youAreOwed)}>{formatBdt(view.outstanding.youAreOwed)}</span></p></div>
          </div>
        </Surface>
        <Surface className="min-h-36" padding="canonical">
          <h2 className="metric-label">Settlement Health</h2>
          <p className="mt-4 text-[20px] font-semibold leading-6">{view.settlementHealth.outstandingCount} outstanding</p>
          <span className="mt-3 inline-flex min-h-7 items-center rounded-full bg-warning-soft px-3 text-xs font-medium text-warning">{view.settlementHealth.pendingCount} pending</span>
        </Surface>
        <MemberContributionsCard month={formatCalendarMonth(view.selectedMonth)} contributions={view.memberContributions} />
      </div>

      <div className="dashboard-analytics-grid mt-6 grid gap-4">
        <ChartCard
          className="col-span-full h-[286px] min-w-0 gap-3 overflow-hidden"
          action={<Button asChild size="sm" variant="outline"><Link href={`/reports/monthly?month=${view.selectedMonth}`} prefetch={false}>View Monthly Report<ArrowRight /></Link></Button>}
          description={`Daily spending for ${formatCalendarMonth(view.selectedMonth)}`}
          padding="canonical"
          summary={trendSummary}
          summaryVisuallyHidden
          title="Spending Trend"
        >
          <p className="sr-only" id="dashboard-spending-trend-description">{trendSummary}</p>
          <DailySpendingChart data={view.dailySpending} descriptionId="dashboard-spending-trend-description" label={`Daily spending bar chart for ${formatCalendarMonth(view.selectedMonth)}, day 1 through day ${view.dailySpending.length}`} month={view.selectedMonth} />
        </ChartCard>
      </div>

      <div className="dashboard-bottom-grid mt-5 grid gap-4">
        <HousemateBalances view={view} />
        <Surface className="relative flex min-h-[366px] flex-col" padding="canonical">
          <h2 className="dashboard-panel-title">Recent Expenses</h2>
          <p className="compact-caption mt-1 text-text-muted">Latest household activity</p>
          <MobileCollapse className="mt-4 min-h-0 flex-1 overflow-hidden flex flex-col" id="dashboard-recent-expenses-body" sectionLabel="Recent Expenses">
            <ExpenseSummaryList compact emptyAction={<Button asChild size="xs" variant="outline"><Link href="/expenses/new" prefetch={false}><Plus />Add Expense</Link></Button>} emptyMessage="No expenses this month" expenses={view.recentExpenses} />
          </MobileCollapse>
          <div className="mt-3"><Button asChild className="h-8 rounded-xl border bg-secondary px-4 text-xs" variant="ghost"><Link href={`/expenses?month=${view.selectedMonth}`} prefetch={false}>View All Expenses</Link></Button></div>
        </Surface>
        <ChartCard className="dashboard-payment-mix-card relative min-h-[286px] min-w-0 gap-3 overflow-hidden" description="Cash vs Card this month" padding="canonical" summary={paymentSummary} summaryVisuallyHidden title="Payment Mix">
          <p className="sr-only" id="dashboard-payment-mix-description">{paymentSummary}</p>
          <MobileCollapse className="min-w-0" id="dashboard-payment-mix-body" sectionLabel="Payment Mix">
            <div className="flex min-h-[174px] w-full min-w-0 flex-col items-center justify-center gap-4 sm:flex-row sm:gap-3">
              {view.paymentMix.total > 0 ? <PaymentMixChart compact descriptionId="dashboard-payment-mix-description" label={`Payment Mix for ${formatCalendarMonth(view.selectedMonth)}`} mix={view.paymentMix} month={view.selectedMonth} /> : <CardEmptyState className="bg-transparent" icon={Wallet} message="No spending this month" />}
              {view.paymentMix.total > 0 ? <div className="w-full min-w-0 sm:flex-1"><PaymentMixRows compact mix={view.paymentMix} /></div> : null}
            </div>
          </MobileCollapse>
        </ChartCard>
      </div>
    </div>
  );
}

function MemberContributionsCard({ month, contributions }: Readonly<{ month: string; contributions: DashboardPageView["memberContributions"] }>) {
  return (
    <Surface className="flex min-h-36 flex-col" padding="canonical">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="metric-label">Member Contributions</h2>
        <p className="compact-caption font-bold text-text-muted">{month}</p>
      </div>
      {contributions.length === 0 ? (
        <CardEmptyState className="mt-3 flex-1 flex-row items-center justify-center gap-3 bg-transparent p-0" icon={Users} message="No expenses recorded for this month yet." />
      ) : (
        <ul className="mt-3 grid max-h-[76px] content-start gap-2 overflow-y-auto pr-1">
          {contributions.map((member) => (
            <li className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2" key={member.userId}>
              <MemberAvatar className="size-6 [&_[data-slot=avatar-fallback]]:bg-secondary [&_[data-slot=avatar-fallback]]:text-[9px]" displayName={member.displayName} />
              <p className="truncate text-row font-medium">{member.displayName}{member.isCurrentUser ? " (You)" : ""}{member.isFormerMember ? " · Former" : ""}</p>
              <p aria-label={`${member.displayName} paid ${formatBdt(member.paid)}`} className="financial-numerals text-row font-semibold">{formatBdt(member.paid)}</p>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}

export function PaymentMixRows({ compact = false, mix }: Readonly<{ compact?: boolean; mix: DashboardPageView["paymentMix"] }>) {  const valueClassName = compact ? "flex flex-col items-end leading-4" : "text-right";
  return (
    <dl className="grid gap-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2"><dt className="flex items-center gap-2 text-xs"><span className="flex size-6 items-center justify-center rounded-lg bg-secondary"><Banknote aria-hidden="true" className="size-3.5 text-text-secondary" /></span>Cash</dt><dd className={`financial-numerals ${valueClassName}`}><span className="text-sm font-semibold">{formatBdt(mix.cash.amount)}</span>{mix.cash.basisPoints === undefined ? null : <span className={compact ? "text-xs font-semibold text-text-secondary" : "ml-2 text-xs font-semibold"}>{formatBasisPointPercentage(mix.cash.basisPoints)}</span>}</dd></div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-2"><dt className="flex items-center gap-2 text-xs"><span className="flex size-6 items-center justify-center rounded-lg bg-brand-soft"><CreditCard aria-hidden="true" className="size-3.5 text-text-secondary" /></span>Card</dt><dd className={`financial-numerals ${valueClassName}`}><span className="text-sm font-semibold">{formatBdt(mix.card.amount)}</span>{mix.card.basisPoints === undefined ? null : <span className={compact ? "text-xs font-semibold text-text-secondary" : "ml-2 text-xs font-semibold"}>{formatBasisPointPercentage(mix.card.basisPoints)}</span>}</dd></div>
    </dl>
  );
}

function HousemateBalances({ view }: Readonly<{ view: DashboardPageView }>) {
  return (
    <Surface className="relative flex min-h-[286px] flex-col" padding="canonical">
      <h2 className="dashboard-panel-title">Housemate Balances</h2>
      <p className="compact-caption mt-1 text-text-muted">Current net position after all expenses</p>
      <MobileCollapse className="mt-4 min-h-0 flex-1" id="dashboard-housemate-balances-body" sectionLabel="Housemate Balances">
        <ul className="flex-1">
          {view.housemateBalances.map((member) => (
            <li className="grid h-[54px] grid-cols-[36px_minmax(0,1fr)_104px] items-center gap-3" key={member.userId}>
              <MemberAvatar className="size-9 [&_[data-slot=avatar-fallback]]:bg-secondary [&_[data-slot=avatar-fallback]]:text-mini" displayName={member.displayName} />
              <div className="min-w-0"><p className="truncate text-row font-semibold">{member.displayName}{member.isCurrentUser ? " (You)" : ""}</p><p className="text-fine text-text-muted">{member.state === "gets-back" ? "Gets back" : member.state === "owes" ? "Owes" : "Settled"}</p></div>
              <p className={`financial-numerals flex h-[30px] items-center justify-center rounded-full text-xs font-semibold ${member.state === "gets-back" ? "bg-success-soft text-success" : member.state === "owes" ? "bg-danger-soft text-danger" : "bg-secondary text-text-secondary"}`}>{member.state === "gets-back" ? "+" : member.state === "owes" ? "-" : ""}{formatBdt(absolutePoisha(member.balance))}</p>
            </li>
          ))}
        </ul>
        {view.housemateBalances.every((member) => member.state === "settled") ? <p className="mt-2 flex items-center gap-2 text-xs text-success"><CircleCheck aria-hidden="true" className="size-4" />Everyone is settled</p> : null}
      </MobileCollapse>
      <div className="mt-3"><Button asChild className="h-8 rounded-xl border bg-secondary px-4 text-xs" variant="ghost"><Link href="/settlements" prefetch={false}>View Settlements</Link></Button></div>
    </Surface>
  );
}
