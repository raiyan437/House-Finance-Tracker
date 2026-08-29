import { ApplicationError } from "@/application/errors/application-error";
import type { HouseholdBalanceSheet } from "@/domain/balances/balance-types";
import { canonicalMemberships } from "@/domain/membership/membership-invariants";
import type { HouseholdRole, MembershipSnapshot } from "@/domain/membership/membership-types";
import type { Poisha } from "@/domain/money/poisha";
import type { Household, MemberIdentityView } from "@/domain/records/domain-records";
import { compareUserIds, type HouseholdId, type UserId } from "@/domain/shared/identifiers";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";

export type HouseholdActionBlockerCode =
  | "OWES_BALANCE"
  | "IS_OWED_BALANCE"
  | "OUTGOING_PENDING_SETTLEMENT"
  | "INCOMING_PENDING_SETTLEMENT"
  | "LEADERSHIP_TRANSFER_REQUIRED"
  | "HOUSEHOLD_DELETE_REQUIRED"
  | "TARGET_OWES_BALANCE"
  | "TARGET_IS_OWED_BALANCE"
  | "TARGET_OUTGOING_PENDING_SETTLEMENT"
  | "TARGET_INCOMING_PENDING_SETTLEMENT"
  | "HOUSEHOLD_LEDGER_NOT_ZERO"
  | "HOUSEHOLD_HAS_PENDING_SETTLEMENT";

export interface HouseholdActionBlocker {
  readonly code: HouseholdActionBlockerCode;
  readonly amount?: Poisha;
}

export interface HouseholdActionPreview {
  readonly eligible: boolean;
  readonly blockers: readonly HouseholdActionBlocker[];
}

export interface HouseholdMemberView {
  readonly memberId: UserId;
  readonly displayName: string;
  readonly role: HouseholdRole;
  readonly roleLabel: "Leader" | "Member";
  readonly isCurrentUser: boolean;
  readonly remove?: HouseholdActionPreview;
}

export interface HouseholdIdentityView {
  readonly householdId: HouseholdId;
  readonly name: string;
  readonly code: string;
}

interface ActiveHouseholdPageBase {
  readonly household: HouseholdIdentityView;
  readonly viewer: Readonly<{ memberId: UserId; role: HouseholdRole }>;
  readonly leader: HouseholdMemberView;
  readonly members: readonly HouseholdMemberView[];
  readonly leave: HouseholdActionPreview;
}

export type ActiveHouseholdPageView =
  | (ActiveHouseholdPageBase & Readonly<{ viewerRole: "member" }>)
  | (ActiveHouseholdPageBase &
      Readonly<{
        viewerRole: "leader";
        deleteHousehold: HouseholdActionPreview;
      }>);

function codePointCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function balanceFor(sheet: HouseholdBalanceSheet, memberId: UserId): Poisha {
  const entry = sheet.balances.find((balance) => balance.memberId === memberId);
  if (!entry) {
    throw new ApplicationError(
      "MALFORMED_PERSISTED_DATA",
      "The household ledger is missing a retained member.",
    );
  }
  return entry.balance;
}

function pendingDirections(
  householdId: HouseholdId,
  memberId: UserId,
  settlements: readonly SettlementRecord[],
): Readonly<{ outgoing: boolean; incoming: boolean }> {
  return {
    outgoing: settlements.some(
      (settlement) =>
        settlement.householdId === householdId &&
        settlement.status === "pending" &&
        settlement.senderId === memberId,
    ),
    incoming: settlements.some(
      (settlement) =>
        settlement.householdId === householdId &&
        settlement.status === "pending" &&
        settlement.receiverId === memberId,
    ),
  };
}

function departureBlockers(
  householdId: HouseholdId,
  memberId: UserId,
  sheet: HouseholdBalanceSheet,
  settlements: readonly SettlementRecord[],
  target: boolean,
): HouseholdActionBlocker[] {
  const blockers: HouseholdActionBlocker[] = [];
  const balance = balanceFor(sheet, memberId);
  if (balance < 0) {
    blockers.push({
      code: target ? "TARGET_OWES_BALANCE" : "OWES_BALANCE",
      amount: balance,
    });
  } else if (balance > 0) {
    blockers.push({
      code: target ? "TARGET_IS_OWED_BALANCE" : "IS_OWED_BALANCE",
      amount: balance,
    });
  }
  const pending = pendingDirections(householdId, memberId, settlements);
  if (pending.outgoing) {
    blockers.push({
      code: target
        ? "TARGET_OUTGOING_PENDING_SETTLEMENT"
        : "OUTGOING_PENDING_SETTLEMENT",
    });
  }
  if (pending.incoming) {
    blockers.push({
      code: target
        ? "TARGET_INCOMING_PENDING_SETTLEMENT"
        : "INCOMING_PENDING_SETTLEMENT",
    });
  }
  return blockers;
}

function preview(blockers: readonly HouseholdActionBlocker[]): HouseholdActionPreview {
  return Object.freeze({
    eligible: blockers.length === 0,
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze(blocker))),
  });
}

export function buildActiveHouseholdPageView(input: Readonly<{
  household: Household;
  actorId: UserId;
  memberships: readonly MembershipSnapshot[];
  profiles: readonly MemberIdentityView[];
  sheet: HouseholdBalanceSheet;
  settlements: readonly SettlementRecord[];
}>): ActiveHouseholdPageView {
  if (input.household.deletedAt) {
    throw new ApplicationError("NOT_FOUND", "Household not found.");
  }
  const memberships = canonicalMemberships(
    input.household.householdId,
    input.memberships,
  );
  const actor = memberships.find(
    (membership) =>
      membership.userId === input.actorId && membership.status === "active",
  );
  if (!actor) {
    throw new ApplicationError("NOT_FOUND", "Active household membership not found.");
  }
  const profileById = new Map(
    input.profiles.map((profile) => [profile.userId, profile]),
  );
  const activeMemberships = memberships.filter(
    (membership) => membership.status === "active",
  );
  const memberViews = activeMemberships.map((membership): HouseholdMemberView => {
    const profile = profileById.get(membership.userId);
    if (!profile) {
      throw new ApplicationError(
        "MALFORMED_PERSISTED_DATA",
        "An active household member profile is unavailable.",
      );
    }
    const base: HouseholdMemberView = Object.freeze({
      memberId: membership.userId,
      displayName: profile.displayName,
      role: membership.role,
      roleLabel: membership.role === "leader" ? "Leader" : "Member",
      isCurrentUser: membership.userId === input.actorId,
      ...(actor.role === "leader" &&
      membership.role === "member" &&
      membership.userId !== input.actorId
        ? {
            remove: preview(
              departureBlockers(
                input.household.householdId,
                membership.userId,
                input.sheet,
                input.settlements,
                true,
              ),
            ),
          }
        : {}),
    });
    return base;
  });
  memberViews.sort((left, right) => {
    if (left.role !== right.role) return left.role === "leader" ? -1 : 1;
    return (
      codePointCompare(left.displayName, right.displayName) ||
      compareUserIds(left.memberId, right.memberId)
    );
  });
  const leader = memberViews.find((member) => member.role === "leader");
  if (!leader) {
    throw new ApplicationError(
      "MALFORMED_PERSISTED_DATA",
      "The active household has no Leader.",
    );
  }
  const leaveBlockers = departureBlockers(
    input.household.householdId,
    input.actorId,
    input.sheet,
    input.settlements,
    false,
  );
  if (actor.role === "leader") {
    leaveBlockers.push({
      code:
        activeMemberships.length === 1
          ? "HOUSEHOLD_DELETE_REQUIRED"
          : "LEADERSHIP_TRANSFER_REQUIRED",
    });
  }
  const base: ActiveHouseholdPageBase = Object.freeze({
    household: Object.freeze({
      householdId: input.household.householdId,
      name: input.household.name,
      code: input.household.code,
    }),
    viewer: Object.freeze({ memberId: input.actorId, role: actor.role }),
    leader,
    members: Object.freeze(memberViews),
    leave: preview(leaveBlockers),
  });
  if (actor.role === "member") {
    return Object.freeze({ ...base, viewerRole: "member" });
  }
  const deleteBlockers: HouseholdActionBlocker[] = [];
  if (input.sheet.balances.some((balance) => balance.balance !== 0)) {
    deleteBlockers.push({ code: "HOUSEHOLD_LEDGER_NOT_ZERO" });
  }
  if (
    input.settlements.some(
      (settlement) =>
        settlement.householdId === input.household.householdId &&
        settlement.status === "pending",
    )
  ) {
    deleteBlockers.push({ code: "HOUSEHOLD_HAS_PENDING_SETTLEMENT" });
  }
  return Object.freeze({
    ...base,
    viewerRole: "leader",
    deleteHousehold: preview(deleteBlockers),
  });
}
