import { DomainError } from "../shared/domain-error";
import type { HouseholdId, UserId } from "../shared/identifiers";
import { canonicalMemberships } from "./membership-invariants";
import type { MembershipSnapshot } from "./membership-types";

export function transferLeadership(
  householdId: HouseholdId,
  actorId: UserId,
  targetId: UserId,
  memberships: readonly MembershipSnapshot[],
): readonly MembershipSnapshot[] {
  const canonical = canonicalMemberships(householdId, memberships);
  const actor = canonical.find((membership) => membership.userId === actorId);
  const target = canonical.find((membership) => membership.userId === targetId);

  if (
    !actor ||
    actor.status !== "active" ||
    actor.role !== "leader" ||
    !target ||
    target.status !== "active" ||
    actorId === targetId
  ) {
    throw new DomainError(
      "LEADERSHIP_TRANSFER_FORBIDDEN",
      "Leadership may transfer only from the current leader to another active member.",
    );
  }

  const transferred = canonical.map((membership) => {
    if (membership.userId === actorId) {
      return Object.freeze({ ...membership, role: "member" as const });
    }
    if (membership.userId === targetId) {
      return Object.freeze({ ...membership, role: "leader" as const });
    }
    return Object.freeze({ ...membership });
  });
  canonicalMemberships(householdId, transferred);
  return Object.freeze(transferred);
}
