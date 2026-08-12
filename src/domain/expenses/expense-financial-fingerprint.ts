import { expenseDate, type ExpenseDate } from "../dates/expense-date";
import { positivePoisha, type PositivePoisha } from "../money/poisha";
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
import type { SplitAllocation } from "../splits/split-types";

export interface ExpenseFinancialFingerprint {
  readonly householdId: HouseholdId;
  readonly amount: PositivePoisha;
  readonly payerId: UserId;
  readonly allocations: readonly SplitAllocation[];
  readonly expenseDate: ExpenseDate;
  readonly payment: ExpensePayment;
  readonly deleted: boolean;
}

function canonicalAllocations(
  fingerprint: ExpenseFinancialFingerprint,
): readonly SplitAllocation[] {
  householdId(fingerprint.householdId);
  userId(fingerprint.payerId);
  positivePoisha(fingerprint.amount);
  expenseDate(fingerprint.expenseDate);
  assertExpensePayment(fingerprint.payment);
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
  return [...fingerprint.allocations].sort((left, right) =>
    compareUserIds(left.participantId, right.participantId),
  );
}

function paymentEquals(left: ExpensePayment, right: ExpensePayment): boolean {
  if (left.method !== right.method) return false;
  if (left.method === "cash" || right.method === "cash") return true;
  return left.cardReference === right.cardReference;
}

function fingerprintsEqual(
  left: ExpenseFinancialFingerprint,
  right: ExpenseFinancialFingerprint,
): boolean {
  const leftAllocations = canonicalAllocations(left);
  const rightAllocations = canonicalAllocations(right);
  return (
    left.householdId === right.householdId &&
    left.amount === right.amount &&
    left.payerId === right.payerId &&
    left.expenseDate === right.expenseDate &&
    left.deleted === right.deleted &&
    paymentEquals(left.payment, right.payment) &&
    leftAllocations.length === rightAllocations.length &&
    leftAllocations.every(
      (allocation, index) =>
        allocation.participantId === rightAllocations[index]?.participantId &&
        allocation.share === rightAllocations[index]?.share,
    )
  );
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
  const canonicalMembers = canonicalMemberships(
    original.householdId,
    memberships,
  );
  const formerIds = new Set(
    canonicalMembers
      .filter((membership) => membership.status === "former")
      .map((membership) => membership.userId),
  );
  const involvedIds = [
    original.payerId,
    ...original.allocations.map((allocation) => allocation.participantId),
    proposed.payerId,
    ...proposed.allocations.map((allocation) => allocation.participantId),
  ];
  const involvesFormerMember = involvedIds.some((id) => formerIds.has(id));

  if (involvesFormerMember && !fingerprintsEqual(original, proposed)) {
    throw new DomainError(
      "FORMER_MEMBER_FINANCIAL_HISTORY_FROZEN",
      "Financial and historical fields involving former members are frozen.",
    );
  }
}
