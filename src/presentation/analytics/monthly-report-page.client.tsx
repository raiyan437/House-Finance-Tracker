"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FileChartColumn, ReceiptText, TrendingDown, TrendingUp } from "lucide-react";
import type { MonthlyReportPageView } from "@/application/analytics/analytics-page";
import { currentLocalCalendarMonth, formatCalendarMonth, tryCalendarMonth, type CalendarMonth } from "@/application/analytics/calendar-month";
import type { Poisha } from "@/domain/money/poisha";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/presentation/components/chart-card";
import { ErrorState, LoadingState } from "@/presentation/components/async-state";
import { MetricCard } from "@/presentation/components/metric-card";
import { Surface } from "@/presentation/components/surface";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { DailySpendingChart, PaymentMixChart } from "./analytics-charts.client";
import { absolutePoisha, formatBasisPointPercentage } from "./analytics-ui";
import { PaymentMixRows } from "./dashboard-page.client";
import { ExpenseSummaryList } from "./expense-summary-list";
import { MonthSelector } from "./month-selector";

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; requestKey: string }>
  | Readonly<{ status: "ready"; requestKey: string; view: MonthlyReportPageView }>;

export function MonthlyReportPageClient() {
  const runtime = useApplicationRuntime();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fallbackMonth] = useState(() => currentLocalCalendarMonth());
  const monthValues = searchParams.getAll("month");
  const month = monthValues.length === 1
    ? tryCalendarMonth(monthValues[0]) ?? fallbackMonth
    : fallbackMonth;
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
    void runtime.analyticsActions.getMonthlyReport(household.householdId, month)
      .then((view) => {
        if (request.current === currentRequest) setLoadState({ status: "ready", requestKey, view });
      })
      .catch(() => {
        if (request.current === currentRequest) setLoadState({ status: "error", requestKey });
      });
  }, [household, month, requestKey, runtime]);

  const changeMonth = (nextMonth: CalendarMonth) => {
    router.push(`/reports/monthly?month=${nextMonth}`);
  };

  return (
    <PageContainer className="space-y-6">
      <Button asChild className="h-9 rounded-xl" size="sm" variant="ghost"><Link href="/dashboard"><ArrowLeft />Back to Dashboard</Link></Button>
      <PageHeader
        action={<MonthSelector ariaLabel="Select Monthly Report month" onChange={changeMonth} options={visibleState.status === "ready" ? visibleState.view.monthOptions : [month]} value={month} />}
        description="Household spending activity for the selected calendar month. Current outstanding is labelled separately."
        title="Monthly Report"
      />
      {visibleState.status === "loading" ? <LoadingState label={`Loading ${formatCalendarMonth(month)} Monthly Report`} /> : null}
      {visibleState.status === "error" ? <ErrorState description="The Monthly Report could not be reconstructed from source records. Your saved financial data was not changed." onRetry={() => setReload((value) => value + 1)} title="Monthly Report unavailable" /> : null}
      {visibleState.status === "ready" ? <MonthlyReportContent view={visibleState.view} /> : null}
    </PageContainer>
  );
}

function comparisonText(view: MonthlyReportPageView): Readonly<{ primary: string; secondary: string }> {
  const comparison = view.comparison;
  if (comparison.kind === "no-spending-either-month") {
    return { primary: "No spending in either month", secondary: `${formatBdt(comparison.delta)} change` };
  }
  if (comparison.kind === "no-previous-spending") {
    return { primary: "No previous-month spending", secondary: `Increase of ${formatBdt(comparison.delta)}` };
  }
  if (comparison.delta === 0) {
    return { primary: "No change from previous month", secondary: "0.00%" };
  }
  const direction = comparison.delta > 0 ? "increase" : "decrease";
  return {
    primary: `${formatBasisPointPercentage(comparison.changeBasisPoints)} ${direction}`,
    secondary: `${comparison.delta > 0 ? "+" : "-"}${formatBdt(absolutePoisha(comparison.delta))}`,
  };
}

export function MonthlyReportContent({ view }: Readonly<{ view: MonthlyReportPageView }>) {
  const comparison = comparisonText(view);
  const trendSummary = view.totalSpending === 0
    ? `No spending in ${formatCalendarMonth(view.selectedMonth)}. All ${view.dailySpending.length} days are represented with zero spending.`
    : `${formatBdt(view.totalSpending)} spent across ${view.dailySpending.length} calendar days, including zero-spending days.`;
  const paymentSummary = view.paymentMix.total === 0
    ? "No spending this month; Cash and Card are both zero."
    : `Cash ${formatBdt(view.paymentMix.cash.amount)} (${formatBasisPointPercentage(view.paymentMix.cash.basisPoints ?? 0)}); Card ${formatBdt(view.paymentMix.card.amount)} (${formatBasisPointPercentage(view.paymentMix.card.basisPoints ?? 0)}).`;
  return (
    <div className="space-y-6">
      <Surface className="flex flex-wrap items-center justify-between gap-4" padding="canonical">
        <div><p className="metric-label">Report month</p><h2 className="mt-1 text-[22px] font-semibold">{formatCalendarMonth(view.selectedMonth)}</h2></div>
        <FileChartColumn aria-hidden="true" className="size-7 text-text-muted" />
      </Surface>
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total Spending" value={<span className="financial-numerals">{formatBdt(view.totalSpending)}</span>} />
        <MetricCard icon={<ReceiptText className="size-5 text-text-muted" />} label="Expense Count" value={<span className="financial-numerals">{view.expenseCount}</span>} />
        <MetricCard icon={view.comparison.kind === "percentage" && view.comparison.delta < 0 ? <TrendingDown className="size-5 text-success" /> : <TrendingUp className="size-5 text-text-muted" />} label="Month-over-Month" supportingText={comparison.secondary} value={<span className="text-lg">{comparison.primary}</span>} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,0.8fr)]">
        <ChartCard description="Daily household spending" summary={trendSummary} title="Daily Spending Trend">
          <p className="sr-only" id="report-spending-trend-description">{trendSummary}</p>
          <DailySpendingChart data={view.dailySpending} descriptionId="report-spending-trend-description" label={`Daily spending bar chart for ${formatCalendarMonth(view.selectedMonth)}, day 1 through day ${view.dailySpending.length}`} />
        </ChartCard>
        <ChartCard description="By amount spent" summary={paymentSummary} title="Payment Mix">
          <p className="sr-only" id="report-payment-mix-description">{paymentSummary}</p>
          {view.paymentMix.total > 0 ? <PaymentMixChart descriptionId="report-payment-mix-description" label={`Payment Mix for ${formatCalendarMonth(view.selectedMonth)}`} mix={view.paymentMix} /> : <p className="py-12 text-center text-body text-text-secondary">No spending this month</p>}
          <PaymentMixRows mix={view.paymentMix} />
        </ChartCard>
      </div>

      <Surface>
        <h2 className="panel-title">Member Contributions and Expense Shares</h2>
        <p className="mt-1 text-body text-text-secondary">Amount Paid and Expense Share are calculated independently from source Expenses and allocations.</p>
        {view.members.length === 0 ? <p className="py-8 text-center text-body text-text-secondary">No member spending this month</p> : (
          <ul className="mt-5 divide-y">
            {view.members.map((member) => (
              <li className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-8" key={member.userId}>
                <div><p className="font-medium">{member.displayName}{member.isCurrentUser ? " (You)" : ""}</p>{member.isFormerMember ? <p className="text-caption text-text-secondary">Former member</p> : null}</div>
                <p className="financial-numerals"><span className="text-caption text-text-secondary sm:block">Paid</span><span className="font-semibold">{formatBdt(member.paid)}</span></p>
                <p className="financial-numerals"><span className="text-caption text-text-secondary sm:block">Share</span><span className="font-semibold">{formatBdt(member.share)}</span></p>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <div className="grid gap-4 xl:grid-cols-2">
        <Surface>
          <h2 className="panel-title">Largest Expenses</h2>
          <div className="mt-5"><ExpenseSummaryList emptyMessage="No expenses this month" expenses={view.largestExpenses} /></div>
        </Surface>
        <SettlementSummary view={view} />
      </div>
    </div>
  );
}

function ActivityRow({ label, count, amount }: Readonly<{ label: string; count: number; amount?: Poisha }>) {
  return <div className="flex items-center justify-between gap-4 py-3"><dt>{label}</dt><dd className="financial-numerals text-right"><span className="font-semibold">{count}</span>{amount === undefined ? null : <span className="ml-3 text-sm text-text-secondary">{formatBdt(amount)}</span>}</dd></div>;
}

function SettlementSummary({ view }: Readonly<{ view: MonthlyReportPageView }>) {
  return (
    <Surface>
      <h2 className="panel-title">Settlement Summary</h2>
      <p className="mt-1 text-body text-text-secondary">Settlement activity during {formatCalendarMonth(view.selectedMonth)}</p>
      <dl className="mt-4 divide-y">
        <ActivityRow amount={view.settlementActivity.claimsCreated.amount} count={view.settlementActivity.claimsCreated.count} label="Claims Created" />
        <ActivityRow amount={view.settlementActivity.confirmed.amount} count={view.settlementActivity.confirmed.count} label="Confirmed" />
        <ActivityRow count={view.settlementActivity.rejected.count} label="Rejected" />
        <ActivityRow count={view.settlementActivity.cancelled.count} label="Cancelled" />
      </dl>
      <div className="mt-5 rounded-xl bg-secondary p-4">
        <p className="text-label text-text-secondary">Current Outstanding</p>
        <p className="financial-numerals mt-2 text-h3">{view.currentOutstanding.count} recommendation{view.currentOutstanding.count === 1 ? "" : "s"} · {formatBdt(view.currentOutstanding.total)}</p>
        <p className="mt-1 text-caption text-text-secondary">Current position — not a month-end balance</p>
      </div>
    </Surface>
  );
}
