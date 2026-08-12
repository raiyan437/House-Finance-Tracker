import type { HouseholdBalanceSheet } from "../balances/balance-types";
import { assertHouseholdBalanceSheet } from "../balances/balance-invariants";
import type { SettlementRecord } from "../settlements/settlement-types";
import { assertSettlementRecord } from "../settlements/settlement-invariants";
import { DomainError, type DomainErrorCode } from "../shared/domain-error";
import type { HouseholdId, UserId } from "../shared/identifiers";
import { canonicalMemberships } from "./membership-invariants";
import type {
  EligibilityDecision,
  MembershipEligibilityFailure,
  MembershipSnapshot,
} from "./membership-types";

function decision(
  reasons: readonly MembershipEligibilityFailure[],
): EligibilityDecision {
  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

function memberBalance(
  householdId: HouseholdId,
  memberId: UserId,
  sheet: HouseholdBalanceSheet,
): number {
  assertHouseholdBalanceSheet(householdId, sheet);
  const balance = sheet.balances.find((entry) => entry.memberId === memberId);
  if (!balance) {
    throw new DomainError(
      "UNKNOWN_BALANCE_MEMBER",
      "Membership eligibility requires a balance for the target member.",
    );
  }
  return balance.balance;
}

function hasPendingSettlement(
  householdId: HouseholdId,
  memberId: UserId,
  settlements: readonly SettlementRecord[],
): boolean {
  settlements.forEach(assertSettlementRecord);
  return settlements.some(
    (settlement) =>
      settlement.householdId === householdId &&
      settlement.status === "pending" &&
      (settlement.senderId === memberId || settlement.receiverId === memberId),
  );
}

export function evaluateLeaveEligibility(
  householdId: HouseholdId,
  actorId: UserId,
  memberships: readonly MembershipSnapshot[],
  sheet: HouseholdBalanceSheet,
  settlements: readonly SettlementRecord[],
): EligibilityDecision {
  assertHouseholdBalanceSheet(householdId, sheet);
  settlements.forEach(assertSettlementRecord);
  const canonical = canonicalMemberships(householdId, memberships);
  const actor = canonical.find((membership) => membership.userId === actorId);
  if (!actor || actor.status !== "active") {
    return decision(["NOT_ACTIVE_HOUSEHOLD_MEMBER"]);
  }

  const reasons: MembershipEligibilityFailure[] = [];
  if (memberBalance(householdId, actorId, sheet) !== 0) {
    reasons.push("MEMBER_BALANCE_NOT_ZERO");
  }
  if (hasPendingSettlement(householdId, actorId, settlements)) {
    reasons.push("MEMBER_HAS_PENDING_SETTLEMENT");
  }
  if (actor.role === "leader") {
    const activeCount = canonical.filter(
      (membership) => membership.status === "active",
    ).length;
    reasons.push(
      activeCount === 1
        ? "LEADER_MUST_DELETE_HOUSEHOLD"
        : "LEADER_TRANSFER_REQUIRED",
    );
  }
  return decision(reasons);
}

export function evaluateRemovalEligibility(
  householdId: HouseholdId,
  actorId: UserId,
  targetId: UserId,
  memberships: readonly MembershipSnapshot[],
  sheet: HouseholdBalanceSheet,
  settlements: readonly SettlementRecord[],
): EligibilityDecision {
  assertHouseholdBalanceSheet(householdId, sheet);
  settlements.forEach(assertSettlementRecord);
  const canonical = canonicalMemberships(householdId, memberships);
  const actor = canonical.find((membership) => membership.userId === actorId);
  const target = canonical.find((membership) => membership.userId === targetId);
  const reasons: MembershipEligibilityFailure[] = [];

  if (
    !actor ||
    actor.status !== "active" ||
    actor.role !== "leader" ||
    !target ||
    target.status !== "active" ||
    target.role === "leader" ||
    actorId === targetId
  ) {
    reasons.push("MEMBER_REMOVAL_FORBIDDEN");
    return decision(reasons);
  }
  if (memberBalance(householdId, targetId, sheet) !== 0) {
    reasons.push("MEMBER_BALANCE_NOT_ZERO");
  }
  if (hasPendingSettlement(householdId, targetId, settlements)) {
    reasons.push("MEMBER_HAS_PENDING_SETTLEMENT");
  }
  return decision(reasons);
}

export function evaluateHouseholdDeletionEligibility(
  householdId: HouseholdId,
  actorId: UserId,
  memberships: readonly MembershipSnapshot[],
  sheet: HouseholdBalanceSheet,
  settlements: readonly SettlementRecord[],
): EligibilityDecision {
  assertHouseholdBalanceSheet(householdId, sheet);
  settlements.forEach(assertSettlementRecord);
  const canonical = canonicalMemberships(householdId, memberships);
  const actor = canonical.find((membership) => membership.userId === actorId);
  const reasons: MembershipEligibilityFailure[] = [];
  if (!actor || actor.status !== "active" || actor.role !== "leader") {
    reasons.push("HOUSEHOLD_DELETE_FORBIDDEN");
  }
  if (sheet.balances.some((balance) => balance.balance !== 0)) {
    reasons.push("MEMBER_BALANCE_NOT_ZERO");
  }
  if (
    settlements.some(
      (settlement) =>
        settlement.householdId === householdId &&
        settlement.status === "pending",
    )
  ) {
    reasons.push("MEMBER_HAS_PENDING_SETTLEMENT");
  }
  return decision(reasons);
}

export function assertEligible(decisionToAssert: EligibilityDecision): void {
  const reason = decisionToAssert.reasons[0];
  if (reason) {
    throw new DomainError(
      reason as DomainErrorCode,
      "The requested household membership action is not eligible.",
    );
  }
}

export function leaveHousehold(
  householdId: HouseholdId,
  actorId: UserId,
  memberships: readonly MembershipSnapshot[],
  sheet: HouseholdBalanceSheet,
  settlements: readonly SettlementRecord[],
): readonly MembershipSnapshot[] {
  assertEligible(
    evaluateLeaveEligibility(
      householdId,
      actorId,
      memberships,
      sheet,
      settlements,
    ),
  );
  return Object.freeze(
    canonicalMemberships(householdId, memberships).map((membership) =>
      membership.userId === actorId
        ? Object.freeze({ ...membership, status: "former" as const })
        : Object.freeze({ ...membership }),
    ),
  );
}

export function removeHouseholdMember(
  householdId: HouseholdId,
  actorId: UserId,
  targetId: UserId,
  memberships: readonly MembershipSnapshot[],
  sheet: HouseholdBalanceSheet,
  settlements: readonly SettlementRecord[],
): readonly MembershipSnapshot[] {
  assertEligible(
    evaluateRemovalEligibility(
      householdId,
      actorId,
      targetId,
      memberships,
      sheet,
      settlements,
    ),
  );
  return Object.freeze(
    canonicalMemberships(householdId, memberships).map((membership) =>
      membership.userId === targetId
        ? Object.freeze({ ...membership, status: "former" as const })
        : Object.freeze({ ...membership }),
    ),
  );
}
