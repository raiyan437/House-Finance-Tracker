import { describe, expect, it } from "vitest";

import type {
  HouseholdBalanceSheet,
  MemberBalance,
} from "../balances/balance-types";
import { poisha, positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import {
  householdId,
  settlementId,
  userId,
  type UserId,
} from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import type { SettlementRecord } from "../settlements/settlement-types";
import {
  evaluateHouseholdDeletionEligibility,
  evaluateLeaveEligibility,
  evaluateRemovalEligibility,
  leaveHousehold,
  removeHouseholdMember,
} from "./membership-eligibility";
import type { MembershipSnapshot } from "./membership-types";

const house = householdId("house");
const leader = userId("leader");
const member = userId("member");
const other = userId("other");
const former = userId("former");
const memberships: readonly MembershipSnapshot[] = [
  { householdId: house, userId: leader, status: "active", role: "leader" },
  { householdId: house, userId: member, status: "active", role: "member" },
  { householdId: house, userId: other, status: "active", role: "member" },
  { householdId: house, userId: former, status: "former", role: "member" },
];

function balanceSheet(overrides: Readonly<Record<string, number>> = {}): HouseholdBalanceSheet {
  const balances: MemberBalance[] = memberships.map((membership) => ({
    householdId: house,
    memberId: membership.userId,
    balance: poisha(overrides[membership.userId] ?? 0),
  }));
  const positive = balances.reduce(
    (sum, balance) =>
      balance.balance > 0 ? sum + balance.balance : sum,
    0,
  );
  const negative = balances.reduce(
    (sum, balance) =>
      balance.balance < 0 ? sum - balance.balance : sum,
    0,
  );
  return {
    householdId: house,
    balances,
    totalCreditorValue: poisha(positive),
    totalDebtorMagnitude: poisha(negative),
  };
}

function pending(senderId: UserId, receiverId: UserId): SettlementRecord {
  const recommendation = {
    householdId: house,
    senderId,
    receiverId,
    amount: positivePoisha(10),
  };
  return {
    settlementId: settlementId(`pending-${senderId}-${receiverId}`),
    householdId: house,
    senderId,
    receiverId,
    amount: positivePoisha(10),
    originatingRecommendation: recommendation,
    createdAt: isoInstant("2026-08-12T16:00:00.000Z"),
    status: "pending",
  };
}

describe("membership eligibility", () => {
  it("allows a normal member with zero balance and no Pending settlement to leave", () => {
    const eligibility = evaluateLeaveEligibility(
      house,
      member,
      memberships,
      balanceSheet(),
      [],
    );
    expect(eligibility).toEqual({ eligible: true, reasons: [] });
    const result = leaveHousehold(
      house,
      member,
      memberships,
      balanceSheet(),
      [],
    );
    expect(result.find((entry) => entry.userId === member)?.status).toBe("former");
    expect(result).toHaveLength(memberships.length);
  });

  it("blocks leave for nonzero balance and any incoming or outgoing Pending settlement", () => {
    expect(
      evaluateLeaveEligibility(
        house,
        member,
        memberships,
        balanceSheet({ member: -10, leader: 10 }),
        [pending(other, member)],
      ).reasons,
    ).toEqual([
      "MEMBER_BALANCE_NOT_ZERO",
      "MEMBER_HAS_PENDING_SETTLEMENT",
    ]);
    expect(
      evaluateLeaveEligibility(
        house,
        member,
        memberships,
        balanceSheet(),
        [pending(member, other)],
      ).reasons,
    ).toContain("MEMBER_HAS_PENDING_SETTLEMENT");
  });

  it("requires a leader with remaining members to transfer leadership first", () => {
    expect(
      evaluateLeaveEligibility(
        house,
        leader,
        memberships,
        balanceSheet(),
        [],
      ).reasons,
    ).toEqual(["LEADER_TRANSFER_REQUIRED"]);
  });

  it("requires a sole remaining leader to explicitly delete the household", () => {
    const sole: readonly MembershipSnapshot[] = [memberships[0]];
    const soleSheet: HouseholdBalanceSheet = {
      householdId: house,
      balances: [
        { householdId: house, memberId: leader, balance: poisha(0) },
      ],
      totalCreditorValue: poisha(0),
      totalDebtorMagnitude: poisha(0),
    };
    expect(
      evaluateLeaveEligibility(house, leader, sole, soleSheet, []),
    ).toEqual({
      eligible: false,
      reasons: ["LEADER_MUST_DELETE_HOUSEHOLD"],
    });
    expect(() => leaveHousehold(house, leader, sole, soleSheet, [])).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "LEADER_MUST_DELETE_HOUSEHOLD",
      }),
    );
  });

  it("allows only the leader to remove a settled active non-leader", () => {
    expect(
      evaluateRemovalEligibility(
        house,
        leader,
        member,
        memberships,
        balanceSheet(),
        [],
      ).eligible,
    ).toBe(true);
    const result = removeHouseholdMember(
      house,
      leader,
      member,
      memberships,
      balanceSheet(),
      [],
    );
    expect(result.find((entry) => entry.userId === member)?.status).toBe("former");
  });

  it("blocks removal by wrong actor, of leader/former, with balance, or with Pending", () => {
    expect(
      evaluateRemovalEligibility(
        house,
        other,
        member,
        memberships,
        balanceSheet(),
        [],
      ).reasons,
    ).toEqual(["MEMBER_REMOVAL_FORBIDDEN"]);
    expect(
      evaluateRemovalEligibility(
        house,
        leader,
        leader,
        memberships,
        balanceSheet(),
        [],
      ).reasons,
    ).toEqual(["MEMBER_REMOVAL_FORBIDDEN"]);
    expect(
      evaluateRemovalEligibility(
        house,
        leader,
        former,
        memberships,
        balanceSheet(),
        [],
      ).reasons,
    ).toEqual(["MEMBER_REMOVAL_FORBIDDEN"]);
    expect(
      evaluateRemovalEligibility(
        house,
        leader,
        member,
        memberships,
        balanceSheet({ member: -10, leader: 10 }),
        [pending(member, other)],
      ).reasons,
    ).toEqual([
      "MEMBER_BALANCE_NOT_ZERO",
      "MEMBER_HAS_PENDING_SETTLEMENT",
    ]);
  });

  it("gates household deletion on leader, all historical balances, and no Pending", () => {
    expect(
      evaluateHouseholdDeletionEligibility(
        house,
        leader,
        memberships,
        balanceSheet(),
        [],
      ),
    ).toEqual({ eligible: true, reasons: [] });
    expect(
      evaluateHouseholdDeletionEligibility(
        house,
        member,
        memberships,
        balanceSheet({ former: 5, leader: -5 }),
        [pending(member, other)],
      ).reasons,
    ).toEqual([
      "HOUSEHOLD_DELETE_FORBIDDEN",
      "MEMBER_BALANCE_NOT_ZERO",
      "MEMBER_HAS_PENDING_SETTLEMENT",
    ]);
  });

  it("never authorizes a former Leader from historical role metadata", () => {
    const formerLeader = userId("former-leader");
    const withFormerLeader: readonly MembershipSnapshot[] = [
      ...memberships,
      { householdId: house, userId: formerLeader, status: "former", role: "leader" },
    ];
    const withFormerSheet: HouseholdBalanceSheet = {
      ...balanceSheet(),
      balances: [
        ...balanceSheet().balances,
        { householdId: house, memberId: formerLeader, balance: poisha(0) },
      ],
    };

    expect(
      evaluateRemovalEligibility(
        house,
        formerLeader,
        member,
        withFormerLeader,
        withFormerSheet,
        [],
      ).reasons,
    ).toEqual(["MEMBER_REMOVAL_FORBIDDEN"]);
    expect(
      evaluateHouseholdDeletionEligibility(
        house,
        formerLeader,
        withFormerLeader,
        withFormerSheet,
        [],
      ).reasons,
    ).toContain("HOUSEHOLD_DELETE_FORBIDDEN");
  });
});
