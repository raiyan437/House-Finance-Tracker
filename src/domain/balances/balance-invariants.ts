import { poisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { householdId, userId, type HouseholdId } from "../shared/identifiers";
import type { HouseholdBalanceSheet } from "./balance-types";

export function assertHouseholdBalanceSheet(
  expectedHouseholdId: HouseholdId,
  sheet: HouseholdBalanceSheet,
): void {
  householdId(expectedHouseholdId);
  if (sheet.householdId !== expectedHouseholdId) {
    throw new DomainError(
      "BALANCE_SHEET_NOT_ZERO_SUM",
      "A balance sheet must belong to the expected household.",
    );
  }
  if (sheet.balances.length === 0) {
    throw new DomainError(
      "BALANCE_SHEET_NOT_ZERO_SUM",
      "A household balance sheet must contain at least one member.",
    );
  }

  poisha(sheet.totalCreditorValue);
  poisha(sheet.totalDebtorMagnitude);
  if (sheet.totalCreditorValue < 0 || sheet.totalDebtorMagnitude < 0) {
    throw new DomainError(
      "BALANCE_SHEET_NOT_ZERO_SUM",
      "Balance-sheet creditor and debtor totals cannot be negative.",
    );
  }

  const seen = new Set<string>();
  let sum = BigInt(0);
  let creditorTotal = BigInt(0);
  let debtorTotal = BigInt(0);
  for (const member of sheet.balances) {
    userId(member.memberId);
    poisha(member.balance);
    if (
      member.householdId !== expectedHouseholdId ||
      seen.has(member.memberId)
    ) {
      throw new DomainError(
        "BALANCE_SHEET_NOT_ZERO_SUM",
        "A balance sheet must contain unique members from one household.",
      );
    }
    seen.add(member.memberId);
    sum += BigInt(member.balance);
    if (member.balance > 0) creditorTotal += BigInt(member.balance);
    if (member.balance < 0) debtorTotal -= BigInt(member.balance);
  }

  if (
    sum !== BigInt(0) ||
    creditorTotal !== debtorTotal ||
    creditorTotal !== BigInt(sheet.totalCreditorValue) ||
    debtorTotal !== BigInt(sheet.totalDebtorMagnitude)
  ) {
    throw new DomainError(
      "BALANCE_SHEET_NOT_ZERO_SUM",
      "A balance sheet must be exactly zero-sum with matching totals.",
    );
  }
}
