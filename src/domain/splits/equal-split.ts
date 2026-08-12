import {
  poishaFromBigInt,
  positivePoisha,
  type PositivePoisha,
} from "../money/poisha";
import type { UserId } from "../shared/identifiers";
import { assertCompleteAllocation, canonicalParticipantIds } from "./split-invariants";
import type { SplitAllocation } from "./split-types";

export function allocateEqualSplit(
  expenseAmount: PositivePoisha,
  participantIds: readonly UserId[],
): readonly SplitAllocation[] {
  positivePoisha(expenseAmount);
  const canonicalIds = canonicalParticipantIds(participantIds);
  const participantCount = BigInt(canonicalIds.length);
  const amount = BigInt(expenseAmount);
  const baseShare = amount / participantCount;
  const remainder = amount % participantCount;

  const allocations = canonicalIds.map((participantId, index) => ({
    participantId,
    share: poishaFromBigInt(
      baseShare + (BigInt(index) < remainder ? BigInt(1) : BigInt(0)),
    ),
  }));

  assertCompleteAllocation(expenseAmount, canonicalIds, allocations);
  return allocations;
}
