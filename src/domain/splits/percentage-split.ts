import {
  FULL_PERCENTAGE_BASIS_POINTS,
  basisPoints,
} from "../money/basis-points";
import {
  poishaFromBigInt,
  positivePoisha,
  type PositivePoisha,
} from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { compareUserIds, type UserId } from "../shared/identifiers";
import { assertCompleteAllocation, canonicalParticipantIds } from "./split-invariants";
import type { PercentageSplitEntry, SplitAllocation } from "./split-types";

interface RankedShare {
  readonly participantId: UserId;
  readonly floorShare: bigint;
  readonly remainder: bigint;
}

function canonicalPercentageEntries(
  participantIds: readonly UserId[],
  entries: readonly PercentageSplitEntry[],
): readonly PercentageSplitEntry[] {
  const canonicalIds = canonicalParticipantIds(participantIds);
  const participantSet = new Set<UserId>(canonicalIds);
  const entryIds = new Set<UserId>();

  for (const entry of entries) {
    basisPoints(entry.basisPoints);
    if (entryIds.has(entry.participantId)) {
      throw new DomainError(
        "DUPLICATE_PARTICIPANT",
        "Each percentage-split participant must appear exactly once.",
      );
    }
    entryIds.add(entry.participantId);

    if (!participantSet.has(entry.participantId)) {
      throw new DomainError(
        "UNKNOWN_SPLIT_PARTICIPANT",
        "A percentage split cannot contain an unselected participant.",
      );
    }
  }

  if (canonicalIds.some((id) => !entryIds.has(id))) {
    throw new DomainError(
      "MISSING_SPLIT_ENTRY",
      "Every selected participant must have one percentage-split entry.",
    );
  }

  const totalBasisPoints = entries.reduce(
    (sum, entry) => sum + BigInt(entry.basisPoints),
    BigInt(0),
  );

  if (totalBasisPoints !== BigInt(FULL_PERCENTAGE_BASIS_POINTS)) {
    throw new DomainError(
      "PERCENTAGE_TOTAL_NOT_100",
      "Percentage-split entries must total exactly 10,000 basis points.",
    );
  }

  return [...entries].sort((left, right) =>
    compareUserIds(left.participantId, right.participantId),
  );
}

export function allocatePercentageSplit(
  expenseAmount: PositivePoisha,
  participantIds: readonly UserId[],
  entries: readonly PercentageSplitEntry[],
): readonly SplitAllocation[] {
  positivePoisha(expenseAmount);
  const canonicalEntries = canonicalPercentageEntries(participantIds, entries);
  const denominator = BigInt(FULL_PERCENTAGE_BASIS_POINTS);
  const amount = BigInt(expenseAmount);

  const rankedShares: RankedShare[] = canonicalEntries.map((entry) => {
    const numerator = amount * BigInt(entry.basisPoints);
    return {
      participantId: entry.participantId,
      floorShare: numerator / denominator,
      remainder: numerator % denominator,
    };
  });

  const floorTotal = rankedShares.reduce(
    (sum, share) => sum + share.floorShare,
    BigInt(0),
  );
  const leftover = amount - floorTotal;

  if (leftover < BigInt(0) || leftover > BigInt(rankedShares.length)) {
    throw new DomainError(
      "ALLOCATION_TOTAL_MISMATCH",
      "Percentage remainder allocation exceeded the participant set.",
    );
  }

  const remainderRank = [...rankedShares].sort((left, right) => {
    if (left.remainder > right.remainder) return -1;
    if (left.remainder < right.remainder) return 1;
    return compareUserIds(left.participantId, right.participantId);
  });
  const receivesRemainder = new Set(
    remainderRank.slice(0, Number(leftover)).map((share) => share.participantId),
  );

  const allocations = rankedShares.map((share) => ({
    participantId: share.participantId,
    share: poishaFromBigInt(
      share.floorShare +
        (receivesRemainder.has(share.participantId) ? BigInt(1) : BigInt(0)),
    ),
  }));

  assertCompleteAllocation(expenseAmount, participantIds, allocations);
  return allocations;
}
