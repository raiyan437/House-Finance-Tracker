import type { MembershipSnapshot } from "../membership/membership-types";
import { poishaFromBigInt } from "../money/poisha";
import type { Expense } from "../records/domain-records";
import { toBalanceExpense } from "../records/domain-records";
import type { HouseholdId } from "../shared/identifiers";
import type { SettlementRecord } from "../settlements/settlement-types";
import { calculateHouseholdBalances } from "./calculate-household-balances";

/**
 * Verifies every persisted financial aggregate that the local product projects.
 * The monthly check keeps Dashboard and Reports totals inside exact safe poisha,
 * while the balance calculation covers ledger members, zero-sum, and settlement
 * effects. Call this inside the authoritative write transaction.
 */
export function assertHouseholdFinancialState(
  householdId: HouseholdId,
  memberships: readonly MembershipSnapshot[],
  expenses: readonly Expense[],
  settlements: readonly SettlementRecord[],
): void {
  calculateHouseholdBalances(
    householdId,
    memberships,
    expenses.map(toBalanceExpense),
    settlements,
  );

  const monthlyTotals = new Map<string, bigint>();
  for (const expense of expenses) {
    if (expense.householdId !== householdId || expense.deletedAt) continue;
    const month = expense.expenseDate.slice(0, 7);
    monthlyTotals.set(
      month,
      (monthlyTotals.get(month) ?? BigInt(0)) + BigInt(expense.amount),
    );
  }
  for (const total of monthlyTotals.values()) poishaFromBigInt(total);
}
