import { compareUserIds, type HouseholdId, type UserId } from "@/domain/shared/identifiers";

function encoded(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

export function membershipKey(householdId: HouseholdId | string, userId: UserId | string): string {
  return encoded([householdId, userId]);
}

export function activeMembershipUserKey(userId: UserId | string): string {
  return encoded([userId]);
}

export function pendingJoinUserKey(userId: UserId | string): string {
  return encoded([userId]);
}

export function pendingSettlementPairKey(
  householdId: HouseholdId,
  first: UserId,
  second: UserId,
): string {
  const [lower, upper] = compareUserIds(first, second) <= 0 ? [first, second] : [second, first];
  return encoded([householdId, lower, upper]);
}
