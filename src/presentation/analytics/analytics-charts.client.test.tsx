import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarMonth } from "@/application/analytics/calendar-month";
import type { DailySpendingPoint } from "@/application/analytics/monthly-analytics";
import { poisha } from "@/domain/money/poisha";
import { DailySpendingChart, weekendDaysOfMonth } from "./analytics-charts-recharts.client";

vi.mock("recharts", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Bar: passthrough,
    BarChart: ({ children, data }: { children?: ReactNode; data?: readonly DailySpendingPoint[] }) => (
      <div data-day-count={data?.length ?? 0} data-testid="bar-chart">{children}</div>
    ),
    CartesianGrid: passthrough,
    Cell: () => null,
    Pie: passthrough,
    PieChart: passthrough,
    ResponsiveContainer: passthrough,
    XAxis: ({ dataKey, interval, tick }: { dataKey?: string; interval?: number; tick?: unknown }) => (
      <div data-interval={interval} data-key={dataKey} data-testid="x-axis" data-tick-kind={typeof tick} />
    ),
    YAxis: passthrough,
  };
});

function spendingPoints(dayCount: number): readonly DailySpendingPoint[] {
  return Array.from({ length: dayCount }, (_, index) => ({ day: index + 1, amount: poisha(0) }));
}

afterEach(cleanup);

describe("DailySpendingChart", () => {
  it.each([
    [28, 616],
    [29, 638],
    [30, 660],
    [31, 682],
  ])("keeps all %i calendar days in the visual axis width", (dayCount, minWidth) => {
    render(
      <DailySpendingChart
        data={spendingPoints(dayCount)}
        descriptionId="daily-spending-description"
        label={`Daily spending bar chart for day 1 through day ${dayCount}`}
      />,
    );

    const chart = screen.getByRole("img", { name: new RegExp(`day 1 through day ${dayCount}`) });
    expect(chart).toHaveAttribute(
      "aria-describedby",
      "daily-spending-description",
    );
    const canvas = chart.querySelector<HTMLElement>('[data-slot="daily-spending-chart-canvas"]');
    if (!canvas) throw new Error("The daily spending chart canvas is missing.");
    expect(canvas).toHaveStyle({ minWidth: `${minWidth}px` });
    expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-day-count", String(dayCount));
  });

  it("delegates every day tick to Recharts through the weekend-aware renderer", () => {
    render(
      <DailySpendingChart
        data={spendingPoints(31)}
        descriptionId="daily-spending-description"
        label="Daily spending bar chart"
        month={calendarMonth("2026-08")}
      />,
    );

    expect(screen.getByTestId("x-axis")).toHaveAttribute("data-key", "day");
    expect(screen.getByTestId("x-axis")).toHaveAttribute("data-interval", "0");
    expect(screen.getByTestId("x-axis")).toHaveAttribute("data-tick-kind", "function");
  });

  it("marks Saturdays and Sundays from the date-only month without timezone conversion", () => {
    const weekends = weekendDaysOfMonth(calendarMonth("2026-08"), spendingPoints(31));
    expect([...weekends].sort((a, b) => a - b)).toEqual([1, 2, 8, 9, 15, 16, 22, 23, 29, 30]);
    const february = weekendDaysOfMonth(calendarMonth("2026-02"), spendingPoints(28));
    expect(february.has(29)).toBe(false);
  });

  it("keeps neutral fills derivable when no month context is provided", () => {
    expect(weekendDaysOfMonth(undefined, spendingPoints(31)).size).toBe(0);
  });
});
