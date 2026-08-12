import type { HouseholdId, UserId } from "../shared/identifiers";

export type MembershipStatus = "active" | "former";
export type HouseholdRole = "leader" | "member";

export interface MembershipSnapshot {
  readonly householdId: HouseholdId;
  readonly userId: UserId;
  readonly status: MembershipStatus;
  readonly role: HouseholdRole;
}

export type MembershipEligibilityFailure =
  | "NOT_ACTIVE_HOUSEHOLD_MEMBER"
  | "MEMBER_BALANCE_NOT_ZERO"
  | "MEMBER_HAS_PENDING_SETTLEMENT"
  | "LEADER_TRANSFER_REQUIRED"
  | "LEADER_MUST_DELETE_HOUSEHOLD"
  | "LEADERSHIP_TRANSFER_FORBIDDEN"
  | "MEMBER_REMOVAL_FORBIDDEN"
  | "HOUSEHOLD_DELETE_FORBIDDEN";

export interface EligibilityDecision {
  readonly eligible: boolean;
  readonly reasons: readonly MembershipEligibilityFailure[];
}
