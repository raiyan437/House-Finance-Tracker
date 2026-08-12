import { DomainError } from "../shared/domain-error";
import { compareUserIds, userId, type UserId } from "../shared/identifiers";
import type { SplitAllocation } from "./split-types";
import { poisha, type PositivePoisha } from "../money/poisha";

export function canonicalParticipantIds(
  participantIds: readonly UserId[],
): readonly UserId[] {
  if (participantIds.length === 0) {
    throw new DomainError(
      "NO_PARTICIPANTS",
      "An expense must have at least one selected participant.",
    );
  }

  participantIds.forEach(userId);

  const uniqueIds = new Set(participantIds);
  if (uniqueIds.size !== participantIds.length) {
    throw new DomainError(
      "DUPLICATE_PARTICIPANT",
      "Each selected participant must appear exactly once.",
    );
  }

  return [...participantIds].sort(compareUserIds);
}

export function assertCompleteAllocation(
  expenseAmount: PositivePoisha,
  participantIds: readonly UserId[],
  allocations: readonly SplitAllocation[],
): void {
  const canonicalIds = canonicalParticipantIds(participantIds);

  if (
    allocations.length !== canonicalIds.length ||
    allocations.some(
      (allocation, index) => allocation.participantId !== canonicalIds[index],
    )
  ) {
    throw new DomainError(
      "ALLOCATION_TOTAL_MISMATCH",
      "A completed allocation must contain every selected participant exactly once in canonical order.",
    );
  }

  for (const allocation of allocations) {
    poisha(allocation.share);
    if (allocation.share < 0) {
      throw new DomainError(
        "NEGATIVE_SPLIT_SHARE",
        "A completed allocation cannot contain a negative share.",
      );
    }
  }

  const total = allocations.reduce(
    (sum, allocation) => sum + BigInt(allocation.share),
    BigInt(0),
  );

  if (total !== BigInt(expenseAmount)) {
    throw new DomainError(
      "ALLOCATION_TOTAL_MISMATCH",
      "A completed allocation must sum exactly to the expense amount.",
    );
  }
}
