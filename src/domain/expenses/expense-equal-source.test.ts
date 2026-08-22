import { describe, expect, it } from "vitest";

import { expenseDate } from "../dates/expense-date";
import { positivePoisha, poisha } from "../money/poisha";
import { assertExpense, type Expense } from "../records/domain-records";
import { expenseId, householdId, userId } from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import { allocateEqualSplit } from "../splits/equal-split";

const participants = [userId("member-a"), userId("member-b")];

function expense(allocations: Expense["allocations"]): Expense {
  return {
    expenseId: expenseId("expense-equal"),
    householdId: householdId("household-equal"),
    creatorId: participants[0],
    payerId: participants[0],
    name: "Equal expense",
    amount: positivePoisha(100),
    expenseDate: expenseDate("2026-08-20"),
    splitMethod: "equal",
    allocations,
    payment: { method: "cash" },
    revision: 1,
    createdAt: isoInstant("2026-08-20T00:00:00.000Z"),
    updatedAt: isoInstant("2026-08-20T00:00:00.000Z"),
  };
}

describe("equal expense source integrity", () => {
  it("accepts only the deterministic canonical equal allocation", () => {
    expect(() =>
      assertExpense(expense(allocateEqualSplit(positivePoisha(100), participants))),
    ).not.toThrow();
  });

  it("rejects an exact-total allocation that forges equal-split shares", () => {
    expect(() =>
      assertExpense(
        expense([
          { participantId: participants[0], share: poisha(99) },
          { participantId: participants[1], share: poisha(1) },
        ]),
      ),
    ).toThrowError(/canonical largest-remainder/);
  });
});
