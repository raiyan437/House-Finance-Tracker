import {
  poishaFromBigInt,
  poisha,
  positivePoisha,
  type Poisha,
  type PositivePoisha,
} from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { compareUserIds, type UserId } from "../shared/identifiers";
import { assertCompleteAllocation, canonicalParticipantIds } from "./split-invariants";
import type { AmountSplitEntry, SplitAllocation } from "./split-types";

export interface AmountSplitSummary {
  readonly allocatedTotal: Poisha;
  readonly remaining: Poisha;
  readonly isExact: boolean;
  readonly allocations: readonly SplitAllocation[];
}

function canonicalAmountEntries(
  participantIds: readonly UserId[],
  entries: readonly AmountSplitEntry[],
): readonly AmountSplitEntry[] {
  const canonicalIds = canonicalParticipantIds(participantIds);
  const participantSet = new Set<UserId>(canonicalIds);
  const entryIds = new Set<UserId>();

  for (const entry of entries) {
    poisha(entry.amount);
    if (entryIds.has(entry.participantId)) {
      throw new DomainError(
        "DUPLICATE_PARTICIPANT",
        "Each amount-split participant must appear exactly once.",
      );
    }
    entryIds.add(entry.participantId);

    if (!participantSet.has(entry.participantId)) {
      throw new DomainError(
        "UNKNOWN_SPLIT_PARTICIPANT",
        "An amount split cannot contain an unselected participant.",
      );
    }

    if (entry.amount < 0) {
      throw new DomainError(
        "NEGATIVE_SPLIT_SHARE",
        "An individual amount share cannot be negative.",
      );
    }
  }

  if (canonicalIds.some((id) => !entryIds.has(id))) {
    throw new DomainError(
      "MISSING_SPLIT_ENTRY",
      "Every selected participant must have one amount-split entry.",
    );
  }

  return [...entries].sort((left, right) =>
    compareUserIds(left.participantId, right.participantId),
  );
}

export function summarizeAmountSplit(
  expenseAmount: PositivePoisha,
  participantIds: readonly UserId[],
  entries: readonly AmountSplitEntry[],
): AmountSplitSummary {
  positivePoisha(expenseAmount);
  const canonicalEntries = canonicalAmountEntries(participantIds, entries);
  const allocatedBigInt = canonicalEntries.reduce(
    (sum, entry) => sum + BigInt(entry.amount),
    BigInt(0),
  );
  const remainingBigInt = BigInt(expenseAmount) - allocatedBigInt;
  const allocatedTotal = poishaFromBigInt(allocatedBigInt);
  const remaining = poishaFromBigInt(remainingBigInt);
  const allocations = canonicalEntries.map((entry) => ({
    participantId: entry.participantId,
    share: entry.amount,
  }));

  return {
    allocatedTotal,
    remaining,
    isExact: remaining === 0,
    allocations,
  };
}

export function allocateAmountSplit(
  expenseAmount: PositivePoisha,
  participantIds: readonly UserId[],
  entries: readonly AmountSplitEntry[],
): readonly SplitAllocation[] {
  const summary = summarizeAmountSplit(expenseAmount, participantIds, entries);

  if (!summary.isExact) {
    throw new DomainError(
      "AMOUNT_SPLIT_TOTAL_MISMATCH",
      "Amount-split entries must sum exactly to the expense amount.",
    );
  }

  assertCompleteAllocation(expenseAmount, participantIds, summary.allocations);
  return summary.allocations;
}
