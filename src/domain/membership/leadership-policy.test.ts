import { describe, expect, it } from "vitest";

import type { MembershipSnapshot } from "./membership-types";
import { DomainError } from "../shared/domain-error";
import { householdId, userId } from "../shared/identifiers";
import { canonicalMemberships } from "./membership-invariants";
import { transferLeadership } from "./leadership-policy";

const house = householdId("house");
const leader = userId("leader");
const target = userId("target");
const former = userId("former");
const memberships: readonly MembershipSnapshot[] = [
  { householdId: house, userId: leader, status: "active", role: "leader" },
  { householdId: house, userId: target, status: "active", role: "member" },
  { householdId: house, userId: former, status: "former", role: "member" },
];

describe("leadership policy", () => {
  it("transfers authority to another active member without financial inputs", () => {
    const transferred = transferLeadership(house, leader, target, memberships);
    expect(
      transferred.find((membership) => membership.userId === leader)?.role,
    ).toBe("member");
    expect(
      transferred.find((membership) => membership.userId === target)?.role,
    ).toBe("leader");
    expect(
      transferred.filter(
        (membership) =>
          membership.status === "active" && membership.role === "leader",
      ),
    ).toHaveLength(1);
    expect(Object.isFrozen(transferred)).toBe(true);
  });

  it.each([
    [target, leader],
    [leader, leader],
    [leader, former],
    [leader, userId("outsider")],
  ] as const)("rejects invalid actor/target transfer", (actorId, targetId) => {
    expect(() =>
      transferLeadership(house, actorId, targetId, memberships),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "LEADERSHIP_TRANSFER_FORBIDDEN",
      }),
    );
  });

  it("requires exactly one active leader in every membership snapshot", () => {
    expect(() =>
      canonicalMemberships(house, [
        ...memberships,
        {
          householdId: house,
          userId: userId("other-leader"),
          status: "active",
          role: "leader",
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "INVALID_HOUSEHOLD_MEMBERSHIP",
      }),
    );
  });

  it("does not authorize a former membership whose historical role is Leader", () => {
    const historicalLeader = userId("historical-leader");
    expect(() =>
      transferLeadership(house, historicalLeader, target, [
        ...memberships,
        {
          householdId: house,
          userId: historicalLeader,
          status: "former",
          role: "leader",
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "LEADERSHIP_TRANSFER_FORBIDDEN",
      }),
    );
  });
});
