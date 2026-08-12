import { DomainError } from "../shared/domain-error";
import { userId, type UserId } from "../shared/identifiers";
import { isoInstant, type IsoInstant } from "../shared/instant";
import type { SettlementRecord, SettlementStatus } from "./settlement-types";
import { assertSettlementRecord } from "./settlement-invariants";

function assertPending(settlement: SettlementRecord): void {
  assertSettlementRecord(settlement);
  if (settlement.status === "confirmed") {
    throw new DomainError(
      "CONFIRMED_SETTLEMENT_IMMUTABLE",
      "A confirmed settlement is immutable financial history.",
    );
  }
  if (settlement.status !== "pending") {
    throw new DomainError(
      "INVALID_SETTLEMENT_TRANSITION",
      "A terminal settlement cannot transition again.",
    );
  }
}

function resolveSettlement(
  settlement: SettlementRecord,
  status: Exclude<SettlementStatus, "pending">,
  resolvedAt: IsoInstant,
): SettlementRecord {
  return Object.freeze({
    ...settlement,
    originatingRecommendation: Object.freeze({
      ...settlement.originatingRecommendation,
    }),
    status,
    resolvedAt,
  });
}

export function confirmSettlement(
  settlement: SettlementRecord,
  actorId: UserId,
  confirmedAt: IsoInstant,
): SettlementRecord {
  assertPending(settlement);
  userId(actorId);
  isoInstant(confirmedAt);
  if (actorId !== settlement.receiverId) {
    throw new DomainError(
      "SETTLEMENT_ACTOR_NOT_RECEIVER",
      "Only the receiver may confirm a Pending settlement.",
    );
  }
  return resolveSettlement(settlement, "confirmed", confirmedAt);
}

export function rejectSettlement(
  settlement: SettlementRecord,
  actorId: UserId,
  rejectedAt: IsoInstant,
): SettlementRecord {
  assertPending(settlement);
  userId(actorId);
  isoInstant(rejectedAt);
  if (actorId !== settlement.receiverId) {
    throw new DomainError(
      "SETTLEMENT_ACTOR_NOT_RECEIVER",
      "Only the receiver may reject a Pending settlement.",
    );
  }
  return resolveSettlement(settlement, "rejected", rejectedAt);
}

export function cancelSettlement(
  settlement: SettlementRecord,
  actorId: UserId,
  cancelledAt: IsoInstant,
): SettlementRecord {
  assertPending(settlement);
  userId(actorId);
  isoInstant(cancelledAt);
  if (actorId !== settlement.senderId) {
    throw new DomainError(
      "SETTLEMENT_ACTOR_NOT_SENDER",
      "Only the sender may cancel a Pending settlement.",
    );
  }
  return resolveSettlement(settlement, "cancelled", cancelledAt);
}
