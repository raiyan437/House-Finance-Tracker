"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { CalendarMonth } from "@/application/analytics/calendar-month";
import type { DailySpendingPoint, PaymentMixResult } from "@/application/analytics/monthly-analytics";

interface DailySpendingChartProps {
  readonly data: readonly DailySpendingPoint[];
  readonly label: string;
  readonly descriptionId: string;
  readonly month?: CalendarMonth;
}

interface PaymentMixChartProps {
  readonly mix: PaymentMixResult;
  readonly label: string;
  readonly descriptionId: string;
  readonly month?: CalendarMonth;
  readonly compact?: boolean;
}

const DAILY_CHART_MIN_DAY_WIDTH = 22;
const WEEKEND_BAR_FILL = "#dde2ea";
const WEEKDAY_BAR_FILL = "#e9edf2";

function currentLocalMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function weekendDaysOfMonth(month: CalendarMonth | undefined, data: readonly DailySpendingPoint[]): ReadonlySet<number> {
  if (!month) return new Set();
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const weekends = new Set<number>();
  for (const point of data) {
    const weekday = new Date(year, monthIndex, point.day).getDay();
    if (weekday === 0 || weekday === 6) weekends.add(point.day);
  }
  return weekends;
}

interface DailySpendingTickProps {
  readonly payload?: { value?: string | number };
  readonly x?: number | string;
  readonly y?: number | string;
  readonly weekend?: boolean;
}

function DailySpendingTick({ payload, x = 0, y = 0, weekend = false }: DailySpendingTickProps) {
  return (
    <text
      className={weekend ? "daily-spending-tick daily-spending-tick-weekend" : "daily-spending-tick"}
      dy={12}
      textAnchor="middle"
      x={x}
      y={y}
    >
      {payload?.value}
    </text>
  );
}

export function DailySpendingChart({ data, label, descriptionId, month }: DailySpendingChartProps) {
  const weekends = weekendDaysOfMonth(month, data);
  const now = new Date();
  const todayDay = month === currentLocalMonthKey(now) ? now.getDate() : undefined;

  return (
    <div
      aria-describedby={descriptionId}
      aria-label={label}
      className="h-[190px] min-w-0 w-full overflow-x-auto overflow-y-hidden min-[768px]:h-[174px]"
      data-slot="daily-spending-chart"
      role="img"
    >
      <div
        className="h-[174px] w-full"
        data-slot="daily-spending-chart-canvas"
        style={{ minWidth: `${Math.max(data.length, 1) * DAILY_CHART_MIN_DAY_WIDTH}px` }}
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart barCategoryGap="38%" data={[...data]} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border-default)" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="day"
              interval={0}
              padding={{ left: 0, right: 0 }}
              tick={(tickProps: DailySpendingTickProps) => (
                <DailySpendingTick {...tickProps} weekend={weekends.has(Number(tickProps.payload?.value))} />
              )}
              tickLine={false}
            />
            <YAxis axisLine={false} hide tickLine={false} width={0} />
            <Bar dataKey="amount" fill={WEEKDAY_BAR_FILL} isAnimationActive={false} maxBarSize={12} radius={[6, 6, 6, 6]}>
              {data.map((point, index) => (
                <Cell
                  fill={
                    todayDay !== undefined && point.day === todayDay
                      ? "var(--brand-primary)"
                      : !month && index === data.length - 1
                        ? "var(--brand-primary)"
                        : weekends.has(point.day)
                          ? WEEKEND_BAR_FILL
                          : WEEKDAY_BAR_FILL
                  }
                  key={point.day}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function PaymentMixChart({ mix, label, descriptionId, compact = false }: PaymentMixChartProps) {
  const data = [
    { name: "Cash", value: mix.cash.basisPoints ?? 0, color: WEEKDAY_BAR_FILL },
    { name: "Card", value: mix.card.basisPoints ?? 0, color: "var(--brand-primary)" },
  ];
  const size = compact ? 104 : 138;
  const innerRadius = compact ? 32 : 43;
  const outerRadius = compact ? 52 : 69;
  return (
    <div aria-describedby={descriptionId} aria-label={label} className="shrink-0" role="img" style={{ height: size, width: size }}>
      <ResponsiveContainer height="100%" width="100%">
        <PieChart>
          <Pie
            cx="50%"
            cy="50%"
            data={data}
            dataKey="value"
            innerRadius={innerRadius}
            isAnimationActive={false}
            label={compact ? undefined : ({ percent, x = 0, y = 0 }: Readonly<{ percent?: number; x?: number; y?: number }>) =>
              percent !== undefined && percent >= 0.08 ? (
                <text className="daily-spending-tick" fontSize={10} textAnchor="middle" x={x} y={y - 6}>
                  {Math.round(percent * 100)}%
                </text>
              ) : null}
            labelLine={compact ? false : { stroke: "var(--border-strong)" }}
            nameKey="name"
            outerRadius={outerRadius}
            stroke="var(--surface-primary)"
            strokeWidth={3}
          >
            {data.map((entry) => <Cell fill={entry.color} key={entry.name} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
