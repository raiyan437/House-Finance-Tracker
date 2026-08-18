import type { PositivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { compareUserIds } from "../shared/identifiers";
import { allocatePercentageSplit } from "../splits/percentage-split";
import type {
  PercentageSplitEntry,
  SplitAllocation,
  SplitMethod,
} from "../splits/split-types";

export type ExpensePercentageSourceStatus =
  | "not-applicable"
  | "available"
  | "legacy-percentage-input-unavailable";

export function expensePercentageSourceStatus(
  splitMethod: SplitMethod,
  percentageEntries: readonly PercentageSplitEntry[] | undefined,
): ExpensePercentageSourceStatus {
  if (splitMethod !== "percentage") return "not-applicable";
  return percentageEntries === undefined
    ? "legacy-percentage-input-unavailable"
    : "available";
}

function canonicalAllocations(
  allocations: readonly SplitAllocation[],
): readonly SplitAllocation[] {
  return [...allocations].sort((left, right) =>
    compareUserIds(left.participantId, right.participantId),
  );
}

export function assertExpensePercentageSource(
  amount: PositivePoisha,
  splitMethod: SplitMethod,
  allocations: readonly SplitAllocation[],
  percentageEntries: readonly PercentageSplitEntry[] | undefined,
): void {
  if (splitMethod !== "percentage") {
    if (percentageEntries !== undefined) {
      throw new DomainError(
        "INVALID_EXPENSE",
        "Only percentage expenses may contain percentage source entries.",
      );
    }
    return;
  }

  // Derived-only Phase 4 percentage records remain valid historical inputs.
  // Application policies prevent financial editing when this source is absent.
  if (percentageEntries === undefined) return;

  const persisted = canonicalAllocations(allocations);
  const regenerated = canonicalAllocations(
    allocatePercentageSplit(
      amount,
      persisted.map((allocation) => allocation.participantId),
      percentageEntries,
    ),
  );

  if (
    persisted.length !== regenerated.length ||
    persisted.some(
      (allocation, index) =>
        allocation.participantId !== regenerated[index]?.participantId ||
        allocation.share !== regenerated[index]?.share,
    )
  ) {
    throw new DomainError(
      "PERCENTAGE_SOURCE_ALLOCATION_MISMATCH",
      "Percentage source entries do not reproduce the persisted allocation.",
    );
  }
}
