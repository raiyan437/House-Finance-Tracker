import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { calendarMonth } from "@/application/analytics/calendar-month";
import type { DashboardPageView, MonthlyReportPageView } from "@/application/analytics/analytics-page";
import { expenseDate } from "@/domain/dates/expense-date";
import { poisha } from "@/domain/money/poisha";
import { expenseId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { DashboardContent } from "./dashboard-page.client";
import { MonthlyReportContent } from "./monthly-report-page.client";
import { MonthSelector } from "./month-selector";

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a> }));
vi.mock("./analytics-charts.client", () => ({
  DailySpendingChart: ({ label }: { label: string }) => <div aria-label={label} role="img" />,
  PaymentMixChart: ({ label }: { label: string }) => <div aria-label={label} role="img" />,
}));

const month = calendarMonth("2026-08");
const raiyan = userId("raiyan");
const john = userId("john");
const daily = Object.freeze(Array.from({ length: 31 }, (_, index) => Object.freeze({ day: index + 1, amount: poisha(index === 0 ? 30_000 : index === 30 ? 12_580 : 0) })));
const paymentMix = Object.freeze({ total: poisha(42_580), cash: Object.freeze({ amount: poisha(30_000), basisPoints: 7_046 }), card: Object.freeze({ amount: poisha(12_580), basisPoints: 2_954 }) });

const dashboard: DashboardPageView = {
  selectedMonth: month,
  monthOptions: [month],
  members: [
    { userId: raiyan, displayName: "Raiyan", isCurrentUser: true, isFormerMember: false },
    { userId: john, displayName: "John", isCurrentUser: false, isFormerMember: false },
  ],
  spent: poisha(42_580),
  outstanding: { youOwe: poisha(0), youAreOwed: poisha(20_000) },
  settlementHealth: { outstandingCount: 1, pendingCount: 1 },
  memberContributions: [
    { userId: raiyan, displayName: "Raiyan", isCurrentUser: true, isFormerMember: false, paid: poisha(30_000) },
    { userId: john, displayName: "John", isCurrentUser: false, isFormerMember: false, paid: poisha(12_580) },
  ],
  dailySpending: daily,
  paymentMix,
  housemateBalances: [
    { userId: raiyan, displayName: "Raiyan", isCurrentUser: true, isFormerMember: false, balance: poisha(20_000), state: "gets-back" },
    { userId: john, displayName: "John", isCurrentUser: false, isFormerMember: false, balance: poisha(-20_000), state: "owes" },
  ],
  recentExpenses: [{
    expenseId: expenseId("expense"), name: "Groceries", amount: poisha(30_000), expenseDate: expenseDate("2026-08-31"),
    createdAt: isoInstant("2026-08-31T12:00:00.000Z"), payer: { userId: john, displayName: "John", isCurrentUser: false, isFormerMember: false }, paymentMethod: "card",
  }],
};

describe("Dashboard analytics presentation", () => {
  it("renders combined outstanding, factual health, amount mix, balances, and safe expense payment", () => {
    render(<DashboardContent view={dashboard} />);
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
    expect(screen.getByText("You Owe")).toBeInTheDocument();
    expect(screen.getByText("You Are Owed")).toBeInTheDocument();
    expect(screen.getByText("1 outstanding")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
    expect(screen.getByText("70.46%")).toBeInTheDocument();
    expect(screen.getByText("29.54%")).toBeInTheDocument();
    expect(screen.getByText("Gets back")).toBeInTheDocument();
    expect(screen.getByText("Owes")).toBeInTheDocument();
    expect(screen.getAllByText("Card").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View Monthly Report" })).toHaveAttribute("href", "/reports/monthly?month=2026-08");
    expect(screen.getByRole("link", { name: "View All Expenses" })).toHaveAttribute("href", "/expenses?month=2026-08");
    expect(screen.getByRole("img", { name: /day 1 through day 31/i })).toBeInTheDocument();
  });

  it("keeps zero Payment Mix textual and does not fabricate percentages", () => {
    render(<DashboardContent view={{ ...dashboard, spent: poisha(0), paymentMix: { total: poisha(0), cash: { amount: poisha(0) }, card: { amount: poisha(0) } }, recentExpenses: [] }} />);
    expect(screen.getByText("No spending this month")).toBeInTheDocument();
    expect(screen.queryByText("50.00%")).not.toBeInTheDocument();
    expect(screen.getByText("No expenses this month")).toBeInTheDocument();
  });

  it("keeps the Add Expense action on Recent Expenses only, not Member Contributions", () => {
    render(<DashboardContent view={{ ...dashboard, memberContributions: [], recentExpenses: [] }} />);
    const addExpenseLinks = screen.getAllByRole("link", { name: "Add Expense" });
    expect(addExpenseLinks).toHaveLength(1);
    expect(addExpenseLinks[0]).toHaveAttribute("href", "/expenses/new");
    const section = screen.getByText("Member Contributions").closest("section");
    expect(section).not.toBeNull();
    if (section) {
      expect(within(section).getByText("No expenses recorded for this month yet.")).toBeInTheDocument();
      expect(within(section).queryByRole("link")).not.toBeInTheDocument();
    }
  });

  it("collapses bottom sections on mobile through accessible toggles", () => {
    render(<DashboardContent view={dashboard} />);
    const toggle = screen.getByRole("button", { name: "Collapse Housemate Balances" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.getAttribute("aria-controls")).toBe("dashboard-housemate-balances-body");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("dashboard-housemate-balances-body")).toHaveAttribute("data-open", "false");
    fireEvent.click(toggle);
    expect(document.getElementById("dashboard-housemate-balances-body")).toHaveAttribute("data-open", "true");
  });

  it("lists exact selected-month member payments and an empty state without spending", () => {
    render(<DashboardContent view={dashboard} />);
    const section = screen.getByText("Member Contributions").closest("section");
    expect(section).not.toBeNull();
    if (!section) return;
    expect(within(section).getByText("August 2026")).toBeInTheDocument();
    expect(within(section).getByText("Raiyan (You)")).toBeInTheDocument();
    expect(within(section).getByLabelText("Raiyan paid ৳300.00")).toBeInTheDocument();
    expect(within(section).getByLabelText("John paid ৳125.80")).toBeInTheDocument();

    const empty = render(<DashboardContent view={{ ...dashboard, memberContributions: [] }} />);
    expect(empty.getAllByText("No expenses recorded for this month yet.").length).toBeGreaterThan(0);
  });
});

describe("Month selector", () => {
  it("is keyboard-compatible and emits only a valid calendar month", () => {
    const onChange = vi.fn();
    render(<MonthSelector onChange={onChange} options={[month, calendarMonth("2028-02")]} value={month} />);
    const trigger = screen.getByRole("combobox", { name: "Select month" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "February 2028" }));
    expect(onChange).toHaveBeenCalledWith("2028-02");
    expect(screen.getByRole("combobox", { name: "Select month" })).toHaveTextContent("August 2026");
  });

  it("steps to adjacent calendar months with chevron buttons", () => {
    const onChange = vi.fn();
    render(<MonthSelector onChange={onChange} options={[calendarMonth("2026-07"), month, calendarMonth("2028-02")]} value={month} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(onChange).toHaveBeenCalledWith("2026-07");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(onChange).toHaveBeenCalledWith("2026-09");
  });

  it("disables stepping beyond the available month range", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MonthSelector onChange={onChange} options={[calendarMonth("2026-07"), month]} value={calendarMonth("2026-07")} />);
    expect(screen.getByRole("button", { name: "Previous month" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Next month" })).toHaveAttribute("aria-disabled", "false");
    rerender(<MonthSelector onChange={onChange} options={[month, calendarMonth("2028-02")]} value={calendarMonth("2028-02")} />);
    expect(screen.getByRole("button", { name: "Next month" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Previous month" })).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(onChange).toHaveBeenCalledWith("2028-01");
  });
});

describe("Monthly Report presentation", () => {
  it("separates former member Paid/Share and current outstanding from month activity", () => {
    const report: MonthlyReportPageView = {
      selectedMonth: month, monthOptions: [month], totalSpending: poisha(42_580), expenseCount: 1,
      comparison: { kind: "no-previous-spending", previousTotal: poisha(0), selectedTotal: poisha(42_580), delta: poisha(42_580) },
      dailySpending: daily, paymentMix,
      members: [{ userId: john, displayName: "Alex", isCurrentUser: false, isFormerMember: true, paid: poisha(30_000), share: poisha(20_000) }],
      largestExpenses: dashboard.recentExpenses,
      settlementActivity: {
        claimsCreated: { count: 1, amount: poisha(2_500) }, confirmed: { count: 1, amount: poisha(2_500) },
        rejected: { count: 0, amount: poisha(0) }, cancelled: { count: 0, amount: poisha(0) },
      },
      currentOutstanding: { count: 2, total: poisha(20_000) },
    };
    render(<MonthlyReportContent view={report} />);
    expect(screen.getByText("No previous-month spending")).toBeInTheDocument();
    const contributions = screen.getByRole("heading", { name: "Member Contributions and Expense Shares" }).parentElement!;
    expect(within(contributions).getByText("Former member")).toBeInTheDocument();
    expect(within(contributions).getByText("Paid")).toBeInTheDocument();
    expect(within(contributions).getByText("Share")).toBeInTheDocument();
    expect(screen.getByText("Current Outstanding")).toBeInTheDocument();
    expect(screen.getByText("Current position — not a month-end balance")).toBeInTheDocument();
    expect(screen.getByText("Claims Created")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });
});
