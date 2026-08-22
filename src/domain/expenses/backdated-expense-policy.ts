import { businessDateAt } from "../dates/business-calendar";
import { expenseDate, type ExpenseDate } from "../dates/expense-date";
import { assertSettlementRecord } from "../settlements/settlement-invariants";
import type { SettlementRecord } from "../settlements/settlement-types";
import { householdId, type HouseholdId } from "../shared/identifiers";
import { isoInstant, type IsoInstant } from "../shared/instant";

export interface BackdatedSettlementBoundary {
  readonly settlementId: SettlementRecord["settlementId"];
  readonly resolvedAt: IsoInstant;
  readonly businessDate: ExpenseDate;
}

export function latestConfirmedSettlementBefore(
  targetHouseholdId: HouseholdId,
  commandInstant: IsoInstant,
  settlementHistory: readonly SettlementRecord[],
): BackdatedSettlementBoundary | undefined {
  householdId(targetHouseholdId);
  isoInstant(commandInstant);
  let latest: SettlementRecord | undefined;
  for (const settlement of settlementHistory) {
    assertSettlementRecord(settlement);
    if (
      settlement.householdId !== targetHouseholdId ||
      settlement.status !== "confirmed" ||
      !settlement.resolvedAt ||
      settlement.resolvedAt >= commandInstant
    ) {
      continue;
    }
    if (!latest || settlement.resolvedAt > latest.resolvedAt!) latest = settlement;
  }
  if (!latest?.resolvedAt) return undefined;
  return Object.freeze({
    settlementId: latest.settlementId,
    resolvedAt: latest.resolvedAt,
    businessDate: businessDateAt(latest.resolvedAt),
  });
}

export function isBackdatedAfterSettlement(
  proposedExpenseDate: ExpenseDate,
  boundary: BackdatedSettlementBoundary | undefined,
): boolean {
  expenseDate(proposedExpenseDate);
  return boundary !== undefined && proposedExpenseDate <= boundary.businessDate;
}
