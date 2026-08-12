import { canonicalMemberships } from "../membership/membership-invariants";
import type { MembershipSnapshot } from "../membership/membership-types";
import { DomainError } from "../shared/domain-error";
import {
  householdId,
  settlementId,
  userId,
  type HouseholdId,
  type SettlementId,
  type UserId,
} from "../shared/identifiers";
import { isoInstant, type IsoInstant } from "../shared/instant";
import type {
  SettlementRecommendation,
  SettlementRecord,
} from "./settlement-types";
import {
  assertSettlementRecommendation,
  assertSettlementRecord,
} from "./settlement-invariants";

function sameUnorderedPair(
  leftSender: UserId,
  leftReceiver: UserId,
  rightSender: UserId,
  rightReceiver: UserId,
): boolean {
  return (
    (leftSender === rightSender && leftReceiver === rightReceiver) ||
    (leftSender === rightReceiver && leftReceiver === rightSender)
  );
}

export function hasPendingSettlementForPair(
  household: HouseholdId,
  firstMemberId: UserId,
  secondMemberId: UserId,
  settlements: readonly SettlementRecord[],
): boolean {
  householdId(household);
  userId(firstMemberId);
  userId(secondMemberId);
  settlements.forEach(assertSettlementRecord);
  return settlements.some(
    (settlement) =>
      settlement.householdId === household &&
      settlement.status === "pending" &&
      sameUnorderedPair(
        settlement.senderId,
        settlement.receiverId,
        firstMemberId,
        secondMemberId,
      ),
  );
}

export interface CreatePendingSettlementInput {
  readonly settlementId: SettlementId;
  readonly householdId: HouseholdId;
  readonly actorId: UserId;
  readonly requestedRecommendation: SettlementRecommendation;
  readonly createdAt: IsoInstant;
  readonly memberships: readonly MembershipSnapshot[];
  readonly currentRecommendations: readonly SettlementRecommendation[];
  readonly existingSettlements: readonly SettlementRecord[];
}

export function createPendingSettlement(
  input: CreatePendingSettlementInput,
): SettlementRecord {
  settlementId(input.settlementId);
  householdId(input.householdId);
  userId(input.actorId);
  isoInstant(input.createdAt);
  const requested = input.requestedRecommendation;
  assertSettlementRecommendation(requested);
  input.currentRecommendations.forEach(assertSettlementRecommendation);

  if (
    requested.householdId !== input.householdId ||
    requested.senderId === requested.receiverId
  ) {
    throw new DomainError(
      "INVALID_SETTLEMENT_PARTIES",
      "A settlement must connect two different members of its household.",
    );
  }
  if (input.actorId !== requested.senderId) {
    throw new DomainError(
      "SETTLEMENT_ACTOR_NOT_SENDER",
      "Only the recommendation sender may create its settlement claim.",
    );
  }

  const memberships = canonicalMemberships(
    input.householdId,
    input.memberships,
  );
  const activeIds = new Set(
    memberships
      .filter((membership) => membership.status === "active")
      .map((membership) => membership.userId),
  );
  if (
    !activeIds.has(requested.senderId) ||
    !activeIds.has(requested.receiverId)
  ) {
    throw new DomainError(
      "SETTLEMENT_MEMBER_INACTIVE",
      "New settlements require two active household members.",
    );
  }

  if (
    hasPendingSettlementForPair(
      input.householdId,
      requested.senderId,
      requested.receiverId,
      input.existingSettlements,
    )
  ) {
    throw new DomainError(
      "DUPLICATE_PENDING_SETTLEMENT",
      "Only one Pending settlement may exist for an unordered member pair.",
    );
  }

  const currentForDirection = input.currentRecommendations.find(
    (recommendation) =>
      recommendation.householdId === input.householdId &&
      recommendation.senderId === requested.senderId &&
      recommendation.receiverId === requested.receiverId,
  );
  if (!currentForDirection) {
    throw new DomainError(
      "SETTLEMENT_NOT_RECOMMENDED",
      "A settlement may be created only from a current recommendation.",
    );
  }
  if (currentForDirection.amount !== requested.amount) {
    throw new DomainError(
      "SETTLEMENT_AMOUNT_MISMATCH",
      "A new settlement must use the full current recommendation amount.",
    );
  }

  const snapshot = Object.freeze({
    householdId: requested.householdId,
    senderId: requested.senderId,
    receiverId: requested.receiverId,
    amount: requested.amount,
  });

  return Object.freeze({
    settlementId: input.settlementId,
    householdId: input.householdId,
    senderId: requested.senderId,
    receiverId: requested.receiverId,
    amount: requested.amount,
    originatingRecommendation: snapshot,
    createdAt: input.createdAt,
    status: "pending",
  });
}
