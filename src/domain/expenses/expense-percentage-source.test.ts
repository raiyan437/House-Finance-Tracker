import { describe, expect, it } from "vitest";

import { expenseDate } from "../dates/expense-date";
import { basisPoints } from "../money/basis-points";
import { poisha, positivePoisha } from "../money/poisha";
import { assertExpense, type Expense } from "../records/domain-records";
import { expenseId, householdId, userId } from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import { allocatePercentageSplit } from "../splits/percentage-split";
import type { PercentageSplitEntry } from "../splits/split-types";
import { expensePercentageSourceStatus } from "./expense-percentage-source";

const participants = [userId("raiyan"), userId("john"), userId("sarah")];
const entries: readonly PercentageSplitEntry[] = [
  { participantId: participants[0]!, basisPoints: basisPoints(3334) },
  { participantId: participants[1]!, basisPoints: basisPoints(3333) },
  { participantId: participants[2]!, basisPoints: basisPoints(3333) },
];
const amount = positivePoisha(10_000);
const now = isoInstant("2026-08-18T12:00:00.000Z");

function percentageExpense(
  overrides: Partial<Expense> = {},
): Expense {
  return {
    expenseId: expenseId("expense-percentage"),
    householdId: householdId("house"),
    creatorId: participants[0]!,
    payerId: participants[0]!,
    name: "Shared meal",
    amount,
    expenseDate: expenseDate("2026-08-18"),
    splitMethod: "percentage",
    percentageEntries: entries,
    allocations: allocatePercentageSplit(amount, participants, entries),
    payment: { method: "cash" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("expense percentage source invariant", () => {
  it("accepts exact source basis points that regenerate the final allocation", () => {
    const expense = percentageExpense();
    expect(() => assertExpense(expense)).not.toThrow();
    expect(expensePercentageSourceStatus(expense.splitMethod, expense.percentageEntries)).toBe("available");
  });

  it("retains an explicit legacy status when source inputs are unavailable", () => {
    const legacy = percentageExpense({ percentageEntries: undefined });
    expect(() => assertExpense(legacy)).not.toThrow();
    expect(expensePercentageSourceStatus(legacy.splitMethod, legacy.percentageEntries)).toBe(
      "legacy-percentage-input-unavailable",
    );
  });

  it("rejects malformed totals, participant mismatches, and derived disagreements", () => {
    expect(() =>
      assertExpense(
        percentageExpense({
          percentageEntries: entries.map((entry, index) =>
            index === 0 ? { ...entry, basisPoints: basisPoints(3333) } : entry,
          ),
        }),
      ),
    ).toThrow();
    const canonical = allocatePercentageSplit(amount, participants, entries);
    expect(() =>
      assertExpense(
        percentageExpense({
          allocations: canonical.map((allocation, index) => ({
            participantId: allocation.participantId,
            share: poisha(
              allocation.share + (index === 0 ? 1 : index === 1 ? -1 : 0),
            ),
          })),
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PERCENTAGE_SOURCE_ALLOCATION_MISMATCH" }),
    );
  });

  it("preserves source distinctions even when tiny amounts yield identical allocations", () => {
    const tiny = positivePoisha(1);
    const two = participants.slice(0, 2);
    const first = [
      { participantId: two[0]!, basisPoints: basisPoints(5001) },
      { participantId: two[1]!, basisPoints: basisPoints(4999) },
    ];
    const second = [
      { participantId: two[0]!, basisPoints: basisPoints(6000) },
      { participantId: two[1]!, basisPoints: basisPoints(4000) },
    ];
    expect(allocatePercentageSplit(tiny, two, first)).toEqual(
      allocatePercentageSplit(tiny, two, second),
    );
    expect(first).not.toEqual(second);
  });

  it("rejects obsolete percentage source on non-percentage current state", () => {
    expect(() =>
      assertExpense(
        percentageExpense({ splitMethod: "amount" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_EXPENSE" }));
  });
});
