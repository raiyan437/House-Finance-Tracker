import { describe, expect, it } from "vitest";

import type { HouseholdBalanceSheet } from "@/domain/balances/balance-types";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import type { Household, UserProfile } from "@/domain/records/domain-records";
import {
  householdId,
  settlementId,
  userId,
  type UserId,
} from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { buildActiveHouseholdPageView } from "./household-page";

const houseId = householdId("projection-house");
const leaderId = userId("leader");
const memberA = userId("member-a");
const memberB = userId("member-b");
const longMember = userId("member-long");
const formerId = userId("former-leader");
const now = isoInstant("2026-08-19T10:00:00.000Z");

const household: Household = {
  householdId: houseId,
  name: "Projection House",
  code: "000000007",
  createdAt: now,
  updatedAt: now,
};

const memberships: readonly MembershipSnapshot[] = [
  { householdId: houseId, userId: memberB, status: "active", role: "member" },
  { householdId: houseId, userId: formerId, status: "former", role: "leader" },
  { householdId: houseId, userId: leaderId, status: "active", role: "leader" },
  { householdId: houseId, userId: longMember, status: "active", role: "member" },
  { householdId: houseId, userId: memberA, status: "active", role: "member" },
];

function profile(id: UserId, displayName: string): UserProfile {
  return {
    userId: id,
    displayName,
    displayEmail: `${id}@example.test`,
    emailKey: `${id}@example.test`,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

const profiles = [
  profile(leaderId, "Zed Leader"),
  profile(memberA, "Alex"),
  profile(memberB, "Alex"),
  profile(longMember, "A very long display name that must remain a label rather than an identity"),
  profile(formerId, "Aardvark Former"),
];

function sheet(overrides: Readonly<Record<string, number>> = {}): HouseholdBalanceSheet {
  const balances = memberships.map((membership) => ({
    householdId: houseId,
    memberId: membership.userId,
    balance: poisha(overrides[membership.userId] ?? 0),
  }));
  return {
    householdId: houseId,
    balances,
    totalCreditorValue: poisha(
      balances.reduce((total, entry) => total + Math.max(entry.balance, 0), 0),
    ),
    totalDebtorMagnitude: poisha(
      balances.reduce((total, entry) => total + Math.max(-entry.balance, 0), 0),
    ),
  };
}

function pending(senderId: UserId, receiverId: UserId): SettlementRecord {
  const recommendation = {
    householdId: houseId,
    senderId,
    receiverId,
    amount: positivePoisha(5),
  };
  return {
    settlementId: settlementId(`pending-${senderId}-${receiverId}`),
    householdId: houseId,
    senderId,
    receiverId,
    amount: positivePoisha(5),
    originatingRecommendation: recommendation,
    createdAt: now,
    status: "pending",
  };
}

describe("Phase 10 household page projection", () => {
  it("shows active members only with Leader-first, code-point, and stable-ID ordering", () => {
    const view = buildActiveHouseholdPageView({
      household,
      actorId: leaderId,
      memberships,
      profiles,
      sheet: sheet(),
      settlements: [],
    });

    expect(view.members.map(({ memberId }) => memberId)).toEqual([
      leaderId,
      longMember,
      memberA,
      memberB,
    ]);
    expect(view.members.map(({ displayName }) => displayName)).not.toContain(
      "Aardvark Former",
    );
    expect(view.leader.memberId).toBe(leaderId);
    expect(view.viewerRole).toBe("leader");
  });

  it("keeps Leader-only projections absent for Members", () => {
    const view = buildActiveHouseholdPageView({
      household,
      actorId: memberA,
      memberships,
      profiles,
      sheet: sheet(),
      settlements: [],
    });

    expect(view.viewerRole).toBe("member");
    expect("deleteHousehold" in view).toBe(false);
    expect(view.members.every((member) => member.remove === undefined)).toBe(true);
  });

  it("distinguishes balance direction and both Pending-settlement directions", () => {
    const view = buildActiveHouseholdPageView({
      household,
      actorId: leaderId,
      memberships,
      profiles,
      sheet: sheet({ [memberA]: -10, [memberB]: 10 }),
      settlements: [pending(memberB, memberA)],
    });
    const alexA = view.members.find((member) => member.memberId === memberA)!;
    const alexB = view.members.find((member) => member.memberId === memberB)!;

    expect(alexA.remove?.blockers.map(({ code }) => code)).toEqual([
      "TARGET_OWES_BALANCE",
      "TARGET_INCOMING_PENDING_SETTLEMENT",
    ]);
    expect(alexB.remove?.blockers.map(({ code }) => code)).toEqual([
      "TARGET_IS_OWED_BALANCE",
      "TARGET_OUTGOING_PENDING_SETTLEMENT",
    ]);
    expect(view.viewerRole === "leader" && view.deleteHousehold.blockers).toEqual([
      { code: "HOUSEHOLD_LEDGER_NOT_ZERO" },
      { code: "HOUSEHOLD_HAS_PENDING_SETTLEMENT" },
    ]);
  });

  it("does not treat a terminal settlement as a departure blocker", () => {
    const terminal = { ...pending(memberA, memberB), status: "cancelled" as const, resolvedAt: now };
    const view = buildActiveHouseholdPageView({
      household,
      actorId: memberA,
      memberships,
      profiles,
      sheet: sheet(),
      settlements: [terminal],
    });

    expect(view.leave).toEqual({ eligible: true, blockers: [] });
  });
});
