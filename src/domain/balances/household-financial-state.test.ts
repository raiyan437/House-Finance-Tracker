import { describe, expect, it } from "vitest";

import { expenseDate } from "../dates/expense-date";
import { poisha, positivePoisha } from "../money/poisha";
import type { Expense } from "../records/domain-records";
import { expenseId, householdId, userId } from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import { assertHouseholdFinancialState } from "./household-financial-state";

const house = householdId("house-safe-aggregates");
const member = userId("member-safe-aggregates");
const memberships = [{ householdId: house, userId: member, status: "active" as const, role: "leader" as const }];

function selfExpense(id: string, amount: number, date = "2026-08-20"): Expense {
  return {
    expenseId: expenseId(id), householdId: house, creatorId: member, payerId: member,
    name: id, amount: positivePoisha(amount), expenseDate: expenseDate(date), splitMethod: "amount",
    allocations: [{ participantId: member, share: poisha(amount) }], payment: { method: "cash" }, revision: 1,
    createdAt: isoInstant("2026-08-20T00:00:00.000Z"), updatedAt: isoInstant("2026-08-20T00:00:00.000Z"),
  };
}

describe("household financial state", () => {
  it("accepts exact safe monthly totals and a zero-sum ledger", () => {
    expect(() => assertHouseholdFinancialState(house, memberships, [
      selfExpense("first", Number.MAX_SAFE_INTEGER - 1), selfExpense("second", 1),
    ], [])).not.toThrow();
  });

  it("rejects a monthly aggregate that exceeds safe exact poisha", () => {
    expect(() => assertHouseholdFinancialState(house, memberships, [
      selfExpense("first", Number.MAX_SAFE_INTEGER), selfExpense("second", 1),
    ], [])).toThrowError(/safe integer range/);
  });
});
