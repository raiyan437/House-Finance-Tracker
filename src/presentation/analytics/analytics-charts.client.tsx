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

export function DailySpendingChart({ data, label, descriptionId }: DailySpendingChartProps) {
  return (
    <div
      aria-describedby={descriptionId}
      aria-label={label}
      className="h-[174px] min-w-0 w-full"
      role="img"
    >
      <ResponsiveContainer height="100%" width="100%">
        <BarChart barCategoryGap="38%" data={[...data]} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border-default)" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="day"
            interval={0}
            padding={{ left: 0, right: 0 }}
            tick={({ x, y, payload }: { x?: string | number; y?: string | number; payload?: { value?: string | number } }) => {
              const day = Number(payload?.value);
              const visible = day === 1 || day === data.length || day % 5 === 0;
              return visible ? (
                <text dy={12} fill="var(--text-muted)" fontSize={10} textAnchor="middle" x={x} y={y}>
                  {day}
                </text>
              ) : <g />;
            }}
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
  );
}

interface PaymentMixChartProps {
  readonly mix: PaymentMixResult;
  readonly label: string;
  readonly descriptionId: string;
}

export function PaymentMixChart({ mix, label, descriptionId }: PaymentMixChartProps) {
  const data = [
    { name: "Cash", value: mix.cash.basisPoints ?? 0, color: "#e9edf2" },
    { name: "Card", value: mix.card.basisPoints ?? 0, color: "var(--brand-primary)" },
  ];
  return (
    <div aria-describedby={descriptionId} aria-label={label} className="size-[138px] shrink-0" role="img">
      <ResponsiveContainer height="100%" width="100%">
        <PieChart>
          <Pie
            cx="50%"
            cy="50%"
            data={data}
            dataKey="value"
            innerRadius={43}
            isAnimationActive={false}
            nameKey="name"
            outerRadius={69}
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
