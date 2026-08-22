import type { ExpenseFinancialFingerprint } from "./expense-financial-fingerprint";
import { expenseFinancialFingerprintsEqual } from "./expense-financial-fingerprint";
import { assertSettlementRecord } from "../settlements/settlement-invariants";
import type { SettlementRecord } from "../settlements/settlement-types";
import { DomainError } from "../shared/domain-error";
import { householdId, type HouseholdId } from "../shared/identifiers";
import { isoInstant, type IsoInstant } from "../shared/instant";

export function latestConfirmedSettlementAt(
  targetHouseholdId: HouseholdId,
  settlementHistory: readonly SettlementRecord[],
): IsoInstant | undefined {
  householdId(targetHouseholdId);
  let latest: IsoInstant | undefined;

  for (const settlement of settlementHistory) {
    assertSettlementRecord(settlement);
    if (
      settlement.householdId !== targetHouseholdId ||
      settlement.status !== "confirmed"
    ) {
      continue;
    }

    const resolvedAt = isoInstant(settlement.resolvedAt!);
    if (latest === undefined || resolvedAt > latest) latest = resolvedAt;
  }

  return latest;
}

export function isExpenseFinanciallyLocked(
  expenseCreatedAt: IsoInstant,
  latestConfirmedAt: IsoInstant | undefined,
): boolean {
  isoInstant(expenseCreatedAt);
  if (latestConfirmedAt === undefined) return false;
  isoInstant(latestConfirmedAt);
  return expenseCreatedAt <= latestConfirmedAt;
}

export function assertConfirmedSettlementFinancialChangeAllowed(
  original: ExpenseFinancialFingerprint,
  proposed: ExpenseFinancialFingerprint,
  expenseCreatedAt: IsoInstant,
  latestConfirmedAt: IsoInstant | undefined,
): void {
  if (
    isExpenseFinanciallyLocked(expenseCreatedAt, latestConfirmedAt) &&
    !expenseFinancialFingerprintsEqual(original, proposed)
  ) {
    throw new DomainError(
      "EXPENSE_FINANCIAL_HISTORY_LOCKED",
      "This expense is part of settled financial history and its financial details cannot be changed.",
    );
  }
}
