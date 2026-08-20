import { describe, expect, it } from "vitest";
import { expenseDate } from "@/domain/dates/expense-date";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import type { Expense, UserProfile } from "@/domain/records/domain-records";
import { expenseId, householdId, settlementId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { calendarMonth } from "./calendar-month";
import { buildDashboardPageView, buildMonthlyReportPageView, type AnalyticsSourceSnapshot } from "./analytics-page";

const house = householdId("house");
const raiyan = userId("raiyan");
const john = userId("john");
const sarah = userId("sarah");
const alex = userId("alex");
const instant = isoInstant("2026-08-01T00:00:00.000Z");

function profile(id: typeof raiyan, displayName: string): UserProfile {
  return { userId: id, displayName, displayEmail: `${id}@example.test`, emailKey: `${id}@example.test`, createdAt: instant, updatedAt: instant };
}

function source(): AnalyticsSourceSnapshot {
  const groceries: Expense = {
    expenseId: expenseId("groceries"), householdId: house, creatorId: alex, payerId: alex,
    name: "Groceries", amount: positivePoisha(4_000), expenseDate: expenseDate("2026-08-10"), splitMethod: "amount",
    allocations: [{ participantId: alex, share: poisha(1_500) }, { participantId: raiyan, share: poisha(2_500) }],
    payment: { method: "card", cardReference: "private-card-secret" }, createdAt: instant, updatedAt: instant,
  };
  const pending: SettlementRecord = {
    settlementId: settlementId("pending"), householdId: house, senderId: john, receiverId: raiyan,
    amount: positivePoisha(700), originatingRecommendation: { householdId: house, senderId: john, receiverId: raiyan, amount: positivePoisha(700) },
    createdAt: instant, status: "pending",
  };
  return {
    householdId: house,
    actorId: raiyan,
    memberships: [
      { householdId: house, userId: raiyan, role: "leader", status: "active" },
      { householdId: house, userId: john, role: "member", status: "active" },
      { householdId: house, userId: sarah, role: "member", status: "active" },
      { householdId: house, userId: alex, role: "member", status: "former" },
    ],
    profiles: [profile(raiyan, "Raiyan"), profile(john, "John"), profile(sarah, "Sarah"), profile(alex, "Alex")],
    expenses: [groceries],
    settlements: [pending],
    sheet: {
      householdId: house,
      balances: [
        { householdId: house, memberId: raiyan, balance: poisha(1_500) },
        { householdId: house, memberId: john, balance: poisha(-700) },
        { householdId: house, memberId: sarah, balance: poisha(-800) },
        { householdId: house, memberId: alex, balance: poisha(0) },
      ],
      totalCreditorValue: poisha(1_500), totalDebtorMagnitude: poisha(1_500),
    },
    recommendations: [
      { householdId: house, senderId: john, receiverId: raiyan, amount: positivePoisha(700) },
      { householdId: house, senderId: sarah, receiverId: raiyan, amount: positivePoisha(800) },
    ],
  };
}

describe("Dashboard analytics projection", () => {
  it("keeps current state separate from month metrics and suppresses Pending pairs", () => {
    const view = buildDashboardPageView(source(), calendarMonth("2026-07"));
    expect(view.spent).toBe(0);
    expect(view.outstanding).toEqual({ youOwe: 0, youAreOwed: 1_500 });
    expect(view.settlementHealth).toEqual({ outstandingCount: 1, pendingCount: 1 });
    expect(view.members.map((member) => member.displayName)).toEqual(["Raiyan", "John", "Sarah"]);
    expect(view.housemateBalances.map((member) => [member.displayName, member.state])).toEqual([
      ["Raiyan", "gets-back"], ["Sarah", "owes"], ["John", "owes"],
    ]);
  });

  it("projects only generic Card information", () => {
    const view = buildDashboardPageView(source(), calendarMonth("2026-08"));
    expect(view.recentExpenses[0]).toMatchObject({ paymentMethod: "card", payer: { displayName: "Alex", isFormerMember: true } });
    expect(JSON.stringify(view.recentExpenses)).not.toContain("private-card-secret");
  });
});

describe("Monthly Report analytics projection", () => {
  it("includes former members who paid or participated and separates current position", () => {
    const view = buildMonthlyReportPageView(source(), calendarMonth("2026-08"), () => calendarMonth("2026-08"));
    expect(view.members.map((member) => ({ name: member.displayName, former: member.isFormerMember, paid: member.paid, share: member.share }))).toEqual([
      { name: "Alex", former: true, paid: 4_000, share: 1_500 },
      { name: "Raiyan", former: false, paid: 0, share: 2_500 },
    ]);
    expect(view.currentOutstanding).toEqual({ count: 2, total: 1_500 });
    expect(view.expenseCount).toBe(1);
  });
});
