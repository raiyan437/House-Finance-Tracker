import { positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import {
  householdId,
  settlementId,
  userId,
} from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import type {
  SettlementRecommendation,
  SettlementRecord,
} from "./settlement-types";

export function assertSettlementRecommendation(
  recommendation: SettlementRecommendation,
): void {
  householdId(recommendation.householdId);
  userId(recommendation.senderId);
  userId(recommendation.receiverId);
  positivePoisha(recommendation.amount);
  if (recommendation.senderId === recommendation.receiverId) {
    throw new DomainError(
      "INVALID_SETTLEMENT_PARTIES",
      "A recommendation sender and receiver must be different members.",
    );
  }
}

export function assertSettlementRecord(settlement: SettlementRecord): void {
  settlementId(settlement.settlementId);
  householdId(settlement.householdId);
  userId(settlement.senderId);
  userId(settlement.receiverId);
  positivePoisha(settlement.amount);
  isoInstant(settlement.createdAt);

  if (
    settlement.status !== "pending" &&
    settlement.status !== "confirmed" &&
    settlement.status !== "rejected" &&
    settlement.status !== "cancelled"
  ) {
    throw new DomainError(
      "INVALID_SETTLEMENT_TRANSITION",
      "A settlement has an unsupported lifecycle status.",
    );
  }

  if (settlement.senderId === settlement.receiverId) {
    throw new DomainError(
      "INVALID_SETTLEMENT_PARTIES",
      "A settlement sender and receiver must be different members.",
    );
  }

  const origin = settlement.originatingRecommendation;
  assertSettlementRecommendation(origin);
  if (
    origin.householdId !== settlement.householdId ||
    origin.senderId !== settlement.senderId ||
    origin.receiverId !== settlement.receiverId
  ) {
    throw new DomainError(
      "INVALID_SETTLEMENT_PARTIES",
      "A settlement must retain its originating recommendation parties.",
    );
  }
  if (origin.amount !== settlement.amount) {
    throw new DomainError(
      "SETTLEMENT_AMOUNT_MISMATCH",
      "A settlement must retain its originating recommendation amount.",
    );
  }

  if (settlement.status === "pending") {
    if (settlement.resolvedAt !== undefined) {
      throw new DomainError(
        "INVALID_SETTLEMENT_TRANSITION",
        "A Pending settlement cannot have a resolution timestamp.",
      );
    }
    return;
  }

  if (!settlement.resolvedAt) {
    throw new DomainError(
      "INVALID_SETTLEMENT_TRANSITION",
      "A terminal settlement requires a resolution timestamp.",
    );
  }
  isoInstant(settlement.resolvedAt);
}
