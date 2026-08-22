import { expenseDate, type ExpenseDate } from "../dates/expense-date";
import { positivePoisha, type PositivePoisha } from "../money/poisha";
import { assertExpensePercentageSource } from "./expense-percentage-source";
import { canonicalMemberships } from "../membership/membership-invariants";
import type { MembershipSnapshot } from "../membership/membership-types";
import {
  assertExpensePayment,
  type ExpensePayment,
} from "../permissions/card-payment-privacy";
import { DomainError } from "../shared/domain-error";
import {
  compareUserIds,
  householdId,
  userId,
  type HouseholdId,
  type UserId,
} from "../shared/identifiers";
import { assertCompleteAllocation } from "../splits/split-invariants";
import type {
  PercentageSplitEntry,
  SplitAllocation,
  SplitMethod,
} from "../splits/split-types";

export interface ExpenseFinancialFingerprint {
  readonly householdId: HouseholdId;
  readonly amount: PositivePoisha;
  readonly payerId: UserId;
  readonly splitMethod: SplitMethod;
  readonly percentageEntries?: readonly PercentageSplitEntry[];
  readonly allocations: readonly SplitAllocation[];
  readonly expenseDate: ExpenseDate;
  readonly payment: ExpensePayment;
  readonly cardAssociationIdentity?: string;
  readonly deleted: boolean;
}

export function expenseInvolvesFormerMember(
  fingerprint: ExpenseFinancialFingerprint,
  memberships: readonly MembershipSnapshot[],
): boolean {
  canonicalAllocations(fingerprint);
  const formerIds = new Set(
    canonicalMemberships(fingerprint.householdId, memberships)
      .filter((membership) => membership.status === "former")
      .map((membership) => membership.userId),
  );
  return [
    fingerprint.payerId,
    ...fingerprint.allocations.map((allocation) => allocation.participantId),
  ].some((id) => formerIds.has(id));
}

function canonicalAllocations(
  fingerprint: ExpenseFinancialFingerprint,
): readonly SplitAllocation[] {
  householdId(fingerprint.householdId);
  userId(fingerprint.payerId);
  positivePoisha(fingerprint.amount);
  expenseDate(fingerprint.expenseDate);
  assertExpensePayment(fingerprint.payment);
  if (
    fingerprint.payment.method === "card" &&
    (!fingerprint.cardAssociationIdentity ||
      fingerprint.cardAssociationIdentity.trim() !==
        fingerprint.cardAssociationIdentity)
  ) {
    throw new DomainError(
      "INVALID_EXPENSE_LEDGER_ENTRY",
      "A Card expense financial fingerprint requires an opaque Card association identity.",
    );
  }
  if (
    fingerprint.payment.method === "cash" &&
    fingerprint.cardAssociationIdentity !== undefined
  ) {
    throw new DomainError(
      "INVALID_EXPENSE_LEDGER_ENTRY",
      "A Cash expense cannot contain a Card association identity.",
    );
  }
  const participantIds = fingerprint.allocations.map(
    (allocation) => allocation.participantId,
  );
  assertCompleteAllocation(
    fingerprint.amount,
    participantIds,
    [...fingerprint.allocations].sort((left, right) =>
      compareUserIds(left.participantId, right.participantId),
    ),
  );
  assertExpensePercentageSource(
    fingerprint.amount,
    fingerprint.splitMethod,
    fingerprint.allocations,
    fingerprint.percentageEntries,
  );
  return [...fingerprint.allocations].sort((left, right) =>
    compareUserIds(left.participantId, right.participantId),
  );
}

function percentageEntriesEqual(
  left: readonly PercentageSplitEntry[] | undefined,
  right: readonly PercentageSplitEntry[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const canonicalLeft = [...left].sort((a, b) =>
    compareUserIds(a.participantId, b.participantId),
  );
  const canonicalRight = [...right].sort((a, b) =>
    compareUserIds(a.participantId, b.participantId),
  );
  return (
    canonicalLeft.length === canonicalRight.length &&
    canonicalLeft.every(
      (entry, index) =>
        entry.participantId === canonicalRight[index]?.participantId &&
        entry.basisPoints === canonicalRight[index]?.basisPoints,
    )
  );
}

export function expenseFinancialFingerprintsEqual(
  left: ExpenseFinancialFingerprint,
  right: ExpenseFinancialFingerprint,
): boolean {
  const leftAllocations = canonicalAllocations(left);
  const rightAllocations = canonicalAllocations(right);
  return (
    left.householdId === right.householdId &&
    left.amount === right.amount &&
    left.payerId === right.payerId &&
    left.splitMethod === right.splitMethod &&
    percentageEntriesEqual(left.percentageEntries, right.percentageEntries) &&
    left.expenseDate === right.expenseDate &&
    left.deleted === right.deleted &&
    left.payment.method === right.payment.method &&
    left.cardAssociationIdentity === right.cardAssociationIdentity &&
    leftAllocations.length === rightAllocations.length &&
    leftAllocations.every(
      (allocation, index) =>
        allocation.participantId === rightAllocations[index]?.participantId &&
        allocation.share === rightAllocations[index]?.share,
    )
  );
}

export function assertLegacyPercentageChangeAllowed(
  original: ExpenseFinancialFingerprint,
  proposed: ExpenseFinancialFingerprint,
): void {
  canonicalAllocations(original);
  canonicalAllocations(proposed);
  const originalIsLegacyPercentage =
    original.splitMethod === "percentage" &&
    original.percentageEntries === undefined;
  if (
    originalIsLegacyPercentage &&
    !expenseFinancialFingerprintsEqual(original, proposed)
  ) {
    throw new DomainError(
      "LEGACY_PERCENTAGE_INPUT_UNAVAILABLE",
      "This legacy percentage expense cannot be financially edited because its original percentage inputs are unavailable.",
    );
  }
}

export function assertFormerMemberChangeAllowed(
  original: ExpenseFinancialFingerprint,
  proposed: ExpenseFinancialFingerprint,
  memberships: readonly MembershipSnapshot[],
): void {
  canonicalAllocations(original);
  canonicalAllocations(proposed);
  if (original.householdId !== proposed.householdId) {
    throw new DomainError(
      "INVALID_EXPENSE_LEDGER_ENTRY",
      "An expense cannot move between households.",
    );
  }
  const involvesFormerMember =
    expenseInvolvesFormerMember(original, memberships) ||
    expenseInvolvesFormerMember(proposed, memberships);

  if (
    involvesFormerMember &&
    !expenseFinancialFingerprintsEqual(original, proposed)
  ) {
    throw new DomainError(
      "FORMER_MEMBER_FINANCIAL_HISTORY_FROZEN",
      "Financial and historical fields involving former members are frozen.",
    );
  }
}
