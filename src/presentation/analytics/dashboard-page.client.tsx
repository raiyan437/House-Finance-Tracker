"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Banknote, CircleCheck, CreditCard } from "lucide-react";
import type { DashboardPageView } from "@/application/analytics/analytics-page";
import { currentLocalCalendarMonth, formatCalendarMonth, type CalendarMonth } from "@/application/analytics/calendar-month";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/presentation/components/chart-card";
import { ErrorState, LoadingState } from "@/presentation/components/async-state";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { MetricCard } from "@/presentation/components/metric-card";
import { Surface } from "@/presentation/components/surface";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { DailySpendingChart, PaymentMixChart } from "./analytics-charts.client";
import { formatBasisPointPercentage, absolutePoisha } from "./analytics-ui";
import { ExpenseSummaryList } from "./expense-summary-list";
import { MonthSelector } from "./month-selector";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; requestKey: string }>
  | Readonly<{ status: "ready"; requestKey: string; view: DashboardPageView }>;

export function DashboardPageClient() {
  const runtime = useApplicationRuntime();
  const [month, setMonth] = useState<CalendarMonth>(() => currentLocalCalendarMonth());
  const [reload, setReload] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const request = useRef(0);
  const household = runtime.status === "ready" &&
    (runtime.household.status === "active-member" || runtime.household.status === "active-leader")
    ? runtime.household.household
    : undefined;
  const requestKey = runtime.status === "ready" && household
    ? `${runtime.session.userId}:${household.householdId}:${month}:${reload}`
    : "unavailable";
  const visibleState = loadState.status !== "loading" && loadState.requestKey === requestKey
    ? loadState
    : { status: "loading" as const };

  useEffect(() => {
    if (runtime.status !== "ready" || !household) return;
    const currentRequest = ++request.current;
    void runtime.analyticsActions.getDashboard(household.householdId, month)
      .then((view) => {
        if (request.current === currentRequest) setLoadState({ status: "ready", requestKey, view });
      })
      .catch(() => {
        if (request.current === currentRequest) setLoadState({ status: "error", requestKey });
      });
  }, [household, month, requestKey, runtime]);

  return (
    <PageContainer className="space-y-5">
      <h1 className="sr-only">Dashboard</h1>
      <div className="flex min-h-11 flex-wrap items-center gap-4">
        <MonthSelector value={month} onChange={setMonth} />
        {visibleState.status === "ready" ? <MemberAvatars members={visibleState.view.members} /> : <div aria-hidden="true" className="h-10" />}
      </div>

      {visibleState.status === "loading" ? <LoadingState label={`Loading ${formatCalendarMonth(month)} Dashboard analytics`} /> : null}
      {visibleState.status === "error" ? (
        <ErrorState
          description="Dashboard analytics could not be reconstructed from the household records. Your saved financial data was not changed."
          onRetry={() => setReload((value) => value + 1)}
          title="Dashboard unavailable"
        />
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
            className={`size-9 ring-2 ring-background ${index === 0 ? "[&_[data-slot=avatar-fallback]]:bg-[#282828] [&_[data-slot=avatar-fallback]]:text-white" : index === 1 ? "[&_[data-slot=avatar-fallback]]:bg-[#ddebff]" : index === 2 ? "[&_[data-slot=avatar-fallback]]:bg-[#e8e1ff]" : "[&_[data-slot=avatar-fallback]]:bg-[#cff4e2]"} [&_[data-slot=avatar-fallback]]:text-[10px]`}
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
        <MetricCard className="h-36" label="Spent" value={<span className="financial-numerals metric-value">{formatBdt(view.spent)}</span>} supportingText={formatCalendarMonth(view.selectedMonth)} />
        <Surface className="h-36" padding="canonical">
          <h2 className="metric-label">Outstanding</h2>
          <div className="mt-5 grid grid-cols-2 divide-x">
            <div className="pr-5"><p className="compact-caption text-text-secondary">You Owe</p><p className="financial-numerals mt-1 text-[22px] font-semibold leading-7 text-danger">{formatBdt(view.outstanding.youOwe)}</p></div>
            <div className="pl-5"><p className="compact-caption text-text-secondary">You Are Owed</p><p className="financial-numerals mt-1 text-[22px] font-semibold leading-7 text-success">{formatBdt(view.outstanding.youAreOwed)}</p></div>
          </div>
        </Surface>
        <Surface className="h-36" padding="canonical">
          <h2 className="metric-label">Settlement Health</h2>
          <p className="mt-4 text-[20px] font-semibold leading-6">{view.settlementHealth.outstandingCount} outstanding</p>
          <span className="mt-3 inline-flex min-h-7 items-center rounded-full bg-warning-soft px-3 text-xs font-medium text-warning">{view.settlementHealth.pendingCount} pending</span>
        </Surface>
      </div>

      <div className="dashboard-analytics-grid mt-6 grid gap-4">
        <ChartCard
          className="h-[286px] gap-3 overflow-hidden"
          action={<Button asChild size="sm" variant="outline"><Link href={`/reports/monthly?month=${view.selectedMonth}`}>View Monthly Report<ArrowRight /></Link></Button>}
          description={`Daily spending for ${formatCalendarMonth(view.selectedMonth)}`}
          padding="canonical"
          summary={trendSummary}
          summaryVisuallyHidden
          title="Spending Trend"
        >
          <p className="sr-only" id="dashboard-spending-trend-description">{trendSummary}</p>
          <DailySpendingChart data={view.dailySpending} descriptionId="dashboard-spending-trend-description" label={`Daily spending bar chart for ${formatCalendarMonth(view.selectedMonth)}, day 1 through day ${view.dailySpending.length}`} />
        </ChartCard>
        <ChartCard className="h-[286px] gap-3 overflow-hidden" description="Cash vs Card this month" padding="canonical" summary={paymentSummary} summaryVisuallyHidden title="Payment Mix">
          <p className="sr-only" id="dashboard-payment-mix-description">{paymentSummary}</p>
          <div className="grid min-h-[174px] grid-cols-[138px_minmax(0,1fr)] items-center gap-4">
            {view.paymentMix.total > 0 ? <PaymentMixChart descriptionId="dashboard-payment-mix-description" label={`Payment Mix for ${formatCalendarMonth(view.selectedMonth)}`} mix={view.paymentMix} /> : <p className="col-span-2 text-center text-body text-text-secondary">No spending this month</p>}
            {view.paymentMix.total > 0 ? <PaymentMixRows mix={view.paymentMix} /> : null}
          </div>
        </ChartCard>
      </div>

      <div className="dashboard-bottom-grid mt-5 grid gap-4">
        <HousemateBalances view={view} />
        <Surface className="flex h-[366px] min-h-0 flex-col" padding="canonical">
          <h2 className="dashboard-panel-title">Recent Expenses</h2>
          <p className="compact-caption mt-1 text-text-muted">Latest household activity</p>
          <div className="mt-4 min-h-0 flex-1 overflow-hidden"><ExpenseSummaryList compact emptyMessage="No expenses this month" expenses={view.recentExpenses} /></div>
          <div className="mt-3"><Button asChild className="h-8 rounded-[10px] border bg-secondary px-4 text-xs" variant="ghost"><Link href={`/expenses?month=${view.selectedMonth}`}>View All Expenses</Link></Button></div>
        </Surface>
      </div>
    </div>
  );
}

export function PaymentMixRows({ mix }: Readonly<{ mix: DashboardPageView["paymentMix"] }>) {
  return (
    <dl className="grid gap-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-2"><dt className="flex items-center gap-2 text-xs"><span className="flex size-6 items-center justify-center rounded-lg bg-secondary"><Banknote aria-hidden="true" className="size-3.5 text-text-secondary" /></span>Cash</dt><dd className="financial-numerals text-right"><span className="text-sm font-semibold">{formatBdt(mix.cash.amount)}</span>{mix.cash.basisPoints === undefined ? null : <span className="ml-2 text-xs font-semibold">{formatBasisPointPercentage(mix.cash.basisPoints)}</span>}</dd></div>
      <div className="grid grid-cols-[1fr_auto] items-center gap-2"><dt className="flex items-center gap-2 text-xs"><span className="flex size-6 items-center justify-center rounded-lg bg-brand-soft"><CreditCard aria-hidden="true" className="size-3.5 text-text-secondary" /></span>Card</dt><dd className="financial-numerals text-right"><span className="text-sm font-semibold">{formatBdt(mix.card.amount)}</span>{mix.card.basisPoints === undefined ? null : <span className="ml-2 text-xs font-semibold">{formatBasisPointPercentage(mix.card.basisPoints)}</span>}</dd></div>
    </dl>
  );
}

function HousemateBalances({ view }: Readonly<{ view: DashboardPageView }>) {
  return (
    <Surface className="flex h-[366px] flex-col" padding="canonical">
      <h2 className="dashboard-panel-title">Housemate Balances</h2>
      <p className="compact-caption mt-1 text-text-muted">Current net position after all expenses</p>
      <ul className="mt-4 flex-1">
        {view.housemateBalances.map((member) => (
          <li className="grid h-[54px] grid-cols-[36px_minmax(0,1fr)_104px] items-center gap-3" key={member.userId}>
            <MemberAvatar className="size-9 [&_[data-slot=avatar-fallback]]:bg-secondary [&_[data-slot=avatar-fallback]]:text-[10px]" displayName={member.displayName} />
            <div className="min-w-0"><p className="truncate text-[13px] font-semibold">{member.displayName}{member.isCurrentUser ? " (You)" : ""}</p><p className="text-[11px] text-text-muted">{member.state === "gets-back" ? "Gets back" : member.state === "owes" ? "Owes" : "Settled"}</p></div>
            <p className={`financial-numerals flex h-[30px] items-center justify-center rounded-full text-xs font-semibold ${member.state === "gets-back" ? "bg-success-soft text-success" : member.state === "owes" ? "bg-danger-soft text-danger" : "bg-secondary text-text-secondary"}`}>{member.state === "gets-back" ? "+" : member.state === "owes" ? "-" : ""}{formatBdt(absolutePoisha(member.balance))}</p>
          </li>
        ))}
      </ul>
      {view.housemateBalances.every((member) => member.state === "settled") ? <p className="mt-2 flex items-center gap-2 text-xs text-success"><CircleCheck aria-hidden="true" className="size-4" />Everyone is settled</p> : null}
      <div className="mt-3"><Button asChild className="h-8 rounded-[10px] border bg-secondary px-4 text-xs" variant="ghost"><Link href="/settlements">View Settlements</Link></Button></div>
    </Surface>
  );
}
