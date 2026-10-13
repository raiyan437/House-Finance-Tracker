import { businessDateAt } from "../dates/business-calendar";
import { assertSettlementRecord } from "../settlements/settlement-invariants";
import type { SettlementRecord } from "../settlements/settlement-types";
import { householdId, type HouseholdId } from "../shared/identifiers";
import { isoInstant, type IsoInstant } from "../shared/instant";
import type { BackdatedSettlementBoundary } from "./backdated-expense-policy";

export interface ConfirmedSettlementHistory {
  readonly householdId: HouseholdId;
  readonly latestConfirmedAt: IsoInstant | undefined;
  before(instant: IsoInstant): BackdatedSettlementBoundary | undefined;
}

/** A single read snapshot's index. Validate every row, including other households,
 * just as the individual boundary functions do. Never reuse across requests/commands. */
export function indexConfirmedSettlementHistory(
  targetHousehold: HouseholdId,
  history: readonly SettlementRecord[],
): ConfirmedSettlementHistory {
  householdId(targetHousehold);
  const firstAtInstant = new Map<
    IsoInstant,
    SettlementRecord["settlementId"]
  >();
  for (const settlement of history) {
    assertSettlementRecord(settlement);
    if (
      settlement.householdId !== targetHousehold ||
      settlement.status !== "confirmed"
    )
      continue;
    const resolvedAt = isoInstant(settlement.resolvedAt!);
    // The original scan selects the first row when confirmation times tie.
    if (!firstAtInstant.has(resolvedAt))
      firstAtInstant.set(resolvedAt, settlement.settlementId);
  }
  const instants = [...firstAtInstant.keys()].sort();
  return Object.freeze({
    householdId: targetHousehold,
    latestConfirmedAt: instants.at(-1),
    before(instant: IsoInstant): BackdatedSettlementBoundary | undefined {
      isoInstant(instant);
      let low = 0;
      let high = instants.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (instants[middle] < instant) low = middle + 1;
        else high = middle;
      }
      const resolvedAt = instants[low - 1];
      if (resolvedAt === undefined) return undefined;
      return Object.freeze({
        settlementId: firstAtInstant.get(resolvedAt)!,
        resolvedAt,
        businessDate: businessDateAt(resolvedAt),
      });
    },
  });
}
