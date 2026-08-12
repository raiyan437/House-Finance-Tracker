import type {
  SettlementRecommendation,
  SettlementRecord,
  SettlementStaleness,
} from "./settlement-types";
import { DomainError } from "../shared/domain-error";
import {
  assertSettlementRecommendation,
  assertSettlementRecord,
} from "./settlement-invariants";

export function assessSettlementStaleness(
  settlement: SettlementRecord,
  currentRecommendations: readonly SettlementRecommendation[],
): SettlementStaleness {
  assertSettlementRecord(settlement);
  currentRecommendations.forEach(assertSettlementRecommendation);
  if (settlement.status !== "pending") {
    throw new DomainError(
      "SETTLEMENT_NOT_PENDING",
      "Staleness applies only to an active Pending settlement.",
    );
  }
  const sameDirection = currentRecommendations.find(
    (recommendation) =>
      recommendation.householdId === settlement.householdId &&
      recommendation.senderId === settlement.senderId &&
      recommendation.receiverId === settlement.receiverId,
  );
  if (sameDirection) {
    return sameDirection.amount === settlement.amount
      ? "current"
      : "amount-changed";
  }

  const reversed = currentRecommendations.some(
    (recommendation) =>
      recommendation.householdId === settlement.householdId &&
      recommendation.senderId === settlement.receiverId &&
      recommendation.receiverId === settlement.senderId,
  );
  return reversed ? "direction-reversed" : "recommendation-absent";
}
