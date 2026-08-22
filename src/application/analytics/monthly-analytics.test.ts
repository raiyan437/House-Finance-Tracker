import { describe, expect, it } from "vitest";
import { expenseDate } from "@/domain/dates/expense-date";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import type { Expense } from "@/domain/records/domain-records";
import { expenseId, householdId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { calendarMonth } from "./calendar-month";
import {
  calculateDailySpending,
  calculateMemberContributions,
  calculateMonthComparison,
  calculateMonthlySpending,
  calculatePaymentMix,
  calculateSettlementActivity,
  selectLargestExpenses,
  selectRecentExpenses,
} from "./monthly-analytics";

const house = householdId("house");
const alice = userId("alice");
const bob = userId("bob");

function expense(input: Partial<Expense> & Pick<Expense, "expenseId" | "amount" | "expenseDate">): Expense {
  return {
    householdId: house,
    creatorId: alice,
    payerId: alice,
    name: input.expenseId,
    splitMethod: "amount",
    allocations: [
      { participantId: alice, share: poisha(Math.floor(input.amount / 2)) },
      { participantId: bob, share: poisha(input.amount - Math.floor(input.amount / 2)) },
    ],
    payment: { method: "cash" },
    createdAt: isoInstant("2026-08-01T00:00:00.000Z"),
    updatedAt: isoInstant("2026-08-01T00:00:00.000Z"),
    ...input,
    revision: input.revision ?? 1,
  };
}

describe("monthly expense analytics", () => {
  const august = calendarMonth("2026-08");
  const expenses = [
    expense({ expenseId: expenseId("cash"), amount: positivePoisha(30_000), expenseDate: expenseDate("2026-08-01") }),
    expense({ expenseId: expenseId("card"), amount: positivePoisha(12_580), expenseDate: expenseDate("2026-08-31"), payment: { method: "card", cardReference: "private" } }),
    expense({ expenseId: expenseId("deleted"), amount: positivePoisha(99_999), expenseDate: expenseDate("2026-08-02"), deletedAt: isoInstant("2026-08-03T00:00:00.000Z"), deletedByUserId: alice }),
    expense({ expenseId: expenseId("july"), amount: positivePoisha(5_000), expenseDate: expenseDate("2026-07-31") }),
  ];

  it("sums full non-deleted amounts by Expense Date", () => {
    expect(calculateMonthlySpending(expenses, august)).toBe(42_580);
  });

  it("represents every day including zero days and month endpoints", () => {
    const daily = calculateDailySpending(expenses, august);
    expect(daily).toHaveLength(31);
    expect(daily[0]).toEqual({ day: 1, amount: 30_000 });
    expect(daily[1]).toEqual({ day: 2, amount: 0 });
    expect(daily[30]).toEqual({ day: 31, amount: 12_580 });
    expect(calculateDailySpending([], calendarMonth("2028-02"))).toHaveLength(29);
  });

  it("calculates Payment Mix by money with exact basis-point apportionment", () => {
    expect(calculatePaymentMix(expenses, august)).toEqual({
      total: 42_580,
      cash: { amount: 30_000, basisPoints: 7_046 },
      card: { amount: 12_580, basisPoints: 2_954 },
    });
    expect(calculatePaymentMix([], august)).toEqual({
      total: 0,
      cash: { amount: 0 },
      card: { amount: 0 },
    });
  });

  it("uses exact month comparison rounding and zero-baseline states", () => {
    expect(calculateMonthComparison(poisha(150), poisha(100))).toEqual({
      kind: "percentage", previousTotal: 100, selectedTotal: 150, delta: 50, changeBasisPoints: BigInt(5_000),
    });
    expect(calculateMonthComparison(poisha(1), poisha(3))).toMatchObject({ changeBasisPoints: BigInt(-6_667) });
    expect(calculateMonthComparison(poisha(500), poisha(0))).toEqual({
      kind: "no-previous-spending", previousTotal: 0, selectedTotal: 500, delta: 500,
    });
    expect(calculateMonthComparison(poisha(0), poisha(0))).toMatchObject({ kind: "no-spending-either-month" });
  });

  it("distinguishes amount paid from canonical allocation shares", () => {
    expect(calculateMemberContributions(expenses, august)).toEqual([
      { userId: alice, paid: 42_580, share: 21_290 },
      { userId: bob, paid: 0, share: 21_290 },
    ]);
  });

  it("applies deterministic recent and largest order", () => {
    const tied = [
      expense({ expenseId: expenseId("b"), amount: positivePoisha(100), expenseDate: expenseDate("2026-08-10"), createdAt: isoInstant("2026-08-10T10:00:00.000Z") }),
      expense({ expenseId: expenseId("a"), amount: positivePoisha(100), expenseDate: expenseDate("2026-08-10"), createdAt: isoInstant("2026-08-10T10:00:00.000Z") }),
      expense({ expenseId: expenseId("large"), amount: positivePoisha(200), expenseDate: expenseDate("2026-08-01") }),
    ];
    expect(selectRecentExpenses(tied, august).map((item) => item.expenseId)).toEqual(["a", "b", "large"]);
    expect(selectLargestExpenses(tied, august).map((item) => item.expenseId)).toEqual(["large", "a", "b"]);
  });
});

describe("monthly settlement activity", () => {
  function settlement(input: Partial<SettlementRecord> & Pick<SettlementRecord, "settlementId" | "createdAt" | "status">): SettlementRecord {
    return {
      householdId: house,
      senderId: alice,
      receiverId: bob,
      amount: positivePoisha(500),
      originatingRecommendation: { householdId: house, senderId: alice, receiverId: bob, amount: positivePoisha(500) },
      ...input,
    } as SettlementRecord;
  }
  const monthFromOffset = (instant: ReturnType<typeof isoInstant>) => calendarMonth(instant === "2026-07-31T23:30:00.000Z" ? "2026-08" : instant.slice(0, 7));

  it("classifies creation and resolution as separate viewer-local events", () => {
    const records = [
      settlement({ settlementId: "created-near-boundary" as SettlementRecord["settlementId"], createdAt: isoInstant("2026-07-31T23:30:00.000Z"), status: "pending" }),
      settlement({ settlementId: "confirmed" as SettlementRecord["settlementId"], createdAt: isoInstant("2026-07-10T00:00:00.000Z"), status: "confirmed", resolvedAt: isoInstant("2026-08-02T00:00:00.000Z") }),
      settlement({ settlementId: "rejected" as SettlementRecord["settlementId"], createdAt: isoInstant("2026-08-03T00:00:00.000Z"), status: "rejected", resolvedAt: isoInstant("2026-08-04T00:00:00.000Z") }),
    ];
    const result = calculateSettlementActivity(records, calendarMonth("2026-08"), monthFromOffset);
    expect(result.claimsCreated).toEqual({ count: 2, amount: 1_000 });
    expect(result.confirmed).toEqual({ count: 1, amount: 500 });
    expect(result.rejected).toEqual({ count: 1, amount: 500 });
    expect(result.cancelled).toEqual({ count: 0, amount: 0 });
  });
});
