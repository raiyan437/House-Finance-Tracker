import { DomainError } from "../shared/domain-error";
import {
  compareUserIds,
  householdId,
  userId,
  type HouseholdId,
} from "../shared/identifiers";
import type { MembershipSnapshot } from "./membership-types";

export function canonicalMemberships(
  expectedHouseholdId: HouseholdId,
  memberships: readonly MembershipSnapshot[],
): readonly MembershipSnapshot[] {
  householdId(expectedHouseholdId);

  if (memberships.length === 0) {
    throw new DomainError(
      "INVALID_HOUSEHOLD_MEMBERSHIP",
      "A household must have at least one membership record.",
    );
  }

  const seen = new Set<string>();
  let activeLeaders = 0;

  for (const membership of memberships) {
    householdId(membership.householdId);
    userId(membership.userId);

    if (membership.householdId !== expectedHouseholdId) {
      throw new DomainError(
        "INVALID_HOUSEHOLD_MEMBERSHIP",
        "Every membership must belong to the same household.",
      );
    }
    if (
      (membership.status !== "active" && membership.status !== "former") ||
      (membership.role !== "leader" && membership.role !== "member")
    ) {
      throw new DomainError(
        "INVALID_HOUSEHOLD_MEMBERSHIP",
        "A membership must have a supported status and role.",
      );
    }
    if (seen.has(membership.userId)) {
      throw new DomainError(
        "INVALID_HOUSEHOLD_MEMBERSHIP",
        "A household cannot contain duplicate member identities.",
      );
    }
    seen.add(membership.userId);

    if (membership.status === "active" && membership.role === "leader") {
      activeLeaders += 1;
    }
  }

  if (activeLeaders !== 1) {
    throw new DomainError(
      "INVALID_HOUSEHOLD_MEMBERSHIP",
      "A household must have exactly one active leader.",
    );
  }

  return [...memberships].sort((left, right) =>
    compareUserIds(left.userId, right.userId),
  );
}
