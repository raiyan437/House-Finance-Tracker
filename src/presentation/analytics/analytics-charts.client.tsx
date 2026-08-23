"use client";

import dynamic from "next/dynamic";
import type { CalendarMonth } from "@/application/analytics/calendar-month";
import type { DailySpendingPoint, PaymentMixResult } from "@/application/analytics/monthly-analytics";

export interface DailySpendingChartProps {
  readonly data: readonly DailySpendingPoint[];
  readonly label: string;
  readonly descriptionId: string;
  readonly month?: CalendarMonth;
}

export interface PaymentMixChartProps {
  readonly mix: PaymentMixResult;
  readonly label: string;
  readonly descriptionId: string;
  readonly month?: CalendarMonth;
  readonly compact?: boolean;
}

function chartLoadingFallback() {
  return <div aria-hidden="true" className="h-full min-h-[120px] w-full rounded-lg bg-secondary/60 motion-safe:animate-pulse" />;
}

const DailySpendingChartBody = dynamic(
  () => import("./analytics-charts-recharts.client").then((module) => module.DailySpendingChart),
  { ssr: false, loading: chartLoadingFallback },
);

const PaymentMixChartBody = dynamic(
  () => import("./analytics-charts-recharts.client").then((module) => module.PaymentMixChart),
  { ssr: false, loading: chartLoadingFallback },
);

export function DailySpendingChart(props: DailySpendingChartProps) {
  return <DailySpendingChartBody {...props} />;
}

export function PaymentMixChart(props: PaymentMixChartProps) {
  return <PaymentMixChartBody {...props} />;
}
