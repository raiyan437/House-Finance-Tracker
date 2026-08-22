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
import type { DailySpendingPoint, PaymentMixResult } from "@/application/analytics/monthly-analytics";

interface DailySpendingChartProps {
  readonly data: readonly DailySpendingPoint[];
  readonly label: string;
  readonly descriptionId: string;
}

const DAILY_CHART_MIN_DAY_WIDTH = 22;

function DailySpendingTick({
  payload,
  x = 0,
  y = 0,
}: Readonly<{ payload?: { value?: string | number }; x?: number | string; y?: number | string }>) {
  return <text className="daily-spending-tick" dy={12} textAnchor="middle" x={x} y={y}>{payload?.value}</text>;
}

export function DailySpendingChart({ data, label, descriptionId }: DailySpendingChartProps) {
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
              tick={<DailySpendingTick />}
              tickLine={false}
            />
            <YAxis axisLine={false} hide tickLine={false} width={0} />
            <Bar dataKey="amount" fill="#e9edf2" isAnimationActive={false} maxBarSize={12} radius={[6, 6, 6, 6]}>
              {data.map((point, index) => (
                <Cell fill={index === data.length - 1 ? "var(--brand-primary)" : "#e9edf2"} key={point.day} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface PaymentMixChartProps {
  readonly mix: PaymentMixResult;
  readonly label: string;
  readonly descriptionId: string;
  readonly compact?: boolean;
}

export function PaymentMixChart({ mix, label, descriptionId, compact = false }: PaymentMixChartProps) {
  const data = [
    { name: "Cash", value: mix.cash.basisPoints ?? 0, color: "#e9edf2" },
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
