import { expenseDate, type ExpenseDate } from "../dates/expense-date";
import { cardColorId, type CardColorId } from "../cards/card-color";
import type { BalanceExpense } from "../expenses/balance-expense";
import { assertExpensePercentageSource } from "../expenses/expense-percentage-source";
import { positivePoisha, type PositivePoisha } from "../money/poisha";
import {
  assertExpensePayment,
  type ExpensePayment,
} from "../permissions/card-payment-privacy";
import { DomainError, type DomainErrorCode } from "../shared/domain-error";
import {
  auditEventId,
  cardId,
  expenseId,
  householdId,
  joinRequestId,
  receiptId,
  userId,
  type AuditEventId,
  type CardId,
  type ExpenseId,
  type HouseholdId,
  type JoinRequestId,
  type ReceiptId,
  type UserId,
} from "../shared/identifiers";
import { isoInstant, type IsoInstant } from "../shared/instant";
import { assertCompleteAllocation } from "../splits/split-invariants";
import { allocateEqualSplit } from "../splits/equal-split";
import type {
  PercentageSplitEntry,
  SplitAllocation,
  SplitMethod,
} from "../splits/split-types";

export interface UserProfile {
  readonly userId: UserId;
  readonly displayName: string;
  readonly displayEmail: string;
  readonly emailKey: string;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
}

/**
 * Privacy-safe member identity projection: the only member fields application
 * views may consume about *other* users. Contact data (email) exists solely on
 * the authenticated user's own full profile.
 */
export interface MemberIdentityView {
  readonly userId: UserId;
  readonly displayName: string;
}

export interface Household {
  readonly householdId: HouseholdId;
  readonly name: string;
  readonly code: string;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
  readonly deletedAt?: IsoInstant;
  readonly deletedByUserId?: UserId;
}

export type JoinRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "household-closed";

export interface JoinRequest {
  readonly joinRequestId: JoinRequestId;
  readonly householdId: HouseholdId;
  readonly userId: UserId;
  readonly status: JoinRequestStatus;
  readonly createdAt: IsoInstant;
  readonly resolvedAt?: IsoInstant;
  readonly resolvedByUserId?: UserId;
}

export interface Expense {
  readonly expenseId: ExpenseId;
  readonly householdId: HouseholdId;
  readonly creatorId: UserId;
  readonly payerId: UserId;
  readonly name: string;
  readonly amount: PositivePoisha;
  readonly expenseDate: ExpenseDate;
  readonly splitMethod: SplitMethod;
  readonly percentageEntries?: readonly PercentageSplitEntry[];
  readonly allocations: readonly SplitAllocation[];
  readonly payment: ExpensePayment;
  readonly revision: number;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
  readonly deletedAt?: IsoInstant;
  readonly deletedByUserId?: UserId;
}

export type CardType = "debit" | "credit";

export interface Card {
  readonly cardId: CardId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly type: CardType;
  readonly colorId: CardColorId;
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
  readonly archivedAt?: IsoInstant;
}

export interface ExpenseCardPrivateSnapshot {
  readonly expenseId: ExpenseId;
  readonly ownerId: UserId;
  readonly cardId: CardId;
  readonly cardName: string;
  readonly cardType: CardType;
  readonly colorId: CardColorId;
}

export const RECEIPT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReceiptMimeType = (typeof RECEIPT_MIME_TYPES)[number];
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const RECEIPT_CONTENT_STATUSES = ["available", "user-deleted", "retention-expired"] as const;
export type ReceiptContentStatus = (typeof RECEIPT_CONTENT_STATUSES)[number];

export interface ReceiptMetadata {
  readonly receiptId: ReceiptId;
  readonly householdId: HouseholdId;
  readonly expenseId: ExpenseId;
  readonly createdByUserId: UserId;
  readonly mimeType: ReceiptMimeType;
  readonly originalFilename?: string;
  readonly sizeBytes: number;
  readonly createdAt: IsoInstant;
  readonly contentStatus: ReceiptContentStatus;
  readonly contentRemovedAt?: IsoInstant;
  readonly contentRemovedByUserId?: UserId;
}

export type AuditAggregateType =
  | "household"
  | "membership"
  | "join-request"
  | "expense"
  | "settlement"
  | "card"
  | "receipt";

export interface AuditEvent {
  readonly auditEventId: AuditEventId;
  readonly householdId: HouseholdId;
  readonly actorId: UserId;
  readonly aggregateType: AuditAggregateType;
  readonly aggregateId: string;
  readonly action: string;
  readonly occurredAt: IsoInstant;
  readonly changedFields: readonly string[];
}

function assertTrimmedText(value: string, code: DomainErrorCode = "INVALID_PROFILE"): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new DomainError(code, "Text values must be non-empty and trimmed.");
  }
}

export function normalizeEmail(input: string): { displayEmail: string; emailKey: string } {
  const displayEmail = input.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(displayEmail)) {
    throw new DomainError("INVALID_PROFILE", "A profile email must be valid.");
  }
  return { displayEmail, emailKey: displayEmail.toLowerCase() };
}

export function assertUserProfile(value: UserProfile): void {
  userId(value.userId);
  assertTrimmedText(value.displayName);
  const email = normalizeEmail(value.displayEmail);
  if (email.emailKey !== value.emailKey) {
    throw new DomainError("INVALID_PROFILE", "The profile email key is not canonical.");
  }
  isoInstant(value.createdAt);
  isoInstant(value.updatedAt);
}

export function assertHousehold(value: Household): void {
  householdId(value.householdId);
  assertTrimmedText(value.name, "INVALID_HOUSEHOLD");
  if (!/^\d{9}$/.test(value.code)) {
    throw new DomainError("INVALID_HOUSEHOLD", "A household code must contain exactly nine digits.");
  }
  isoInstant(value.createdAt);
  isoInstant(value.updatedAt);
  if (value.deletedAt) isoInstant(value.deletedAt);
  if (value.deletedByUserId) userId(value.deletedByUserId);
  if (Boolean(value.deletedAt) !== Boolean(value.deletedByUserId)) {
    throw new DomainError("INVALID_HOUSEHOLD", "Household deletion metadata must be complete.");
  }
}

export function assertJoinRequest(value: JoinRequest): void {
  joinRequestId(value.joinRequestId);
  householdId(value.householdId);
  userId(value.userId);
  isoInstant(value.createdAt);
  if (
    ![
      "pending",
      "accepted",
      "rejected",
      "cancelled",
      "household-closed",
    ].includes(value.status)
  ) {
    throw new DomainError("INVALID_JOIN_REQUEST", "Unsupported join request status.");
  }
  if (value.status === "pending") {
    if (value.resolvedAt || value.resolvedByUserId) {
      throw new DomainError("INVALID_JOIN_REQUEST", "Pending requests cannot be resolved.");
    }
  } else if (!value.resolvedAt || !value.resolvedByUserId) {
    throw new DomainError("INVALID_JOIN_REQUEST", "Terminal requests require resolver metadata.");
  }
  if (value.resolvedAt) isoInstant(value.resolvedAt);
  if (value.resolvedByUserId) userId(value.resolvedByUserId);
}

export function assertExpense(value: Expense): void {
  expenseId(value.expenseId);
  householdId(value.householdId);
  userId(value.creatorId);
  userId(value.payerId);
  assertTrimmedText(value.name, "INVALID_EXPENSE");
  positivePoisha(value.amount);
  expenseDate(value.expenseDate);
  if (value.creatorId !== value.payerId) {
    throw new DomainError("PAYER_CREATOR_MISMATCH", "The expense payer and creator must match.");
  }
  if (!["equal", "amount", "percentage"].includes(value.splitMethod)) {
    throw new DomainError("INVALID_EXPENSE", "Unsupported expense split method.");
  }
  assertCompleteAllocation(value.amount, value.allocations.map((item) => item.participantId), value.allocations);
  if (value.splitMethod === "equal") {
    const expected = allocateEqualSplit(
      value.amount,
      value.allocations.map((allocation) => allocation.participantId),
    );
    if (
      expected.some(
        (allocation, index) =>
          allocation.participantId !== value.allocations[index]?.participantId ||
          allocation.share !== value.allocations[index]?.share,
      )
    ) {
      throw new DomainError(
        "INVALID_EXPENSE",
        "Equal split allocations must use the canonical largest-remainder result.",
      );
    }
  }
  assertExpensePercentageSource(
    value.amount,
    value.splitMethod,
    value.allocations,
    value.percentageEntries,
  );
  assertExpensePayment(value.payment);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new DomainError("INVALID_EXPENSE", "Expense revision must be a positive safe integer.");
  }
  isoInstant(value.createdAt);
  isoInstant(value.updatedAt);
  if (value.deletedAt) isoInstant(value.deletedAt);
  if (value.deletedByUserId) userId(value.deletedByUserId);
  if (Boolean(value.deletedAt) !== Boolean(value.deletedByUserId)) {
    throw new DomainError("INVALID_EXPENSE", "Expense deletion metadata must be complete.");
  }
}

export function toBalanceExpense(value: Expense): BalanceExpense {
  assertExpense(value);
  return {
    expenseId: value.expenseId,
    householdId: value.householdId,
    payerId: value.payerId,
    amount: value.amount,
    allocations: value.allocations,
    deleted: Boolean(value.deletedAt),
  };
}

export function assertCard(value: Card): void {
  cardId(value.cardId);
  userId(value.ownerId);
  assertTrimmedText(value.name, "INVALID_CARD");
  cardColorId(value.colorId);
  if (value.type !== "debit" && value.type !== "credit") {
    throw new DomainError("INVALID_CARD", "Unsupported card type.");
  }
  isoInstant(value.createdAt);
  isoInstant(value.updatedAt);
  if (value.archivedAt) isoInstant(value.archivedAt);
}

export function assertExpenseCardPrivateSnapshot(value: ExpenseCardPrivateSnapshot): void {
  expenseId(value.expenseId);
  userId(value.ownerId);
  cardId(value.cardId);
  assertTrimmedText(value.cardName, "INVALID_CARD");
  cardColorId(value.colorId);
  if (value.cardType !== "debit" && value.cardType !== "credit") {
    throw new DomainError("INVALID_CARD", "Unsupported historical card type.");
  }
}

export function assertReceiptMetadata(value: ReceiptMetadata): void {
  receiptId(value.receiptId);
  householdId(value.householdId);
  expenseId(value.expenseId);
  userId(value.createdByUserId);
  if (!RECEIPT_MIME_TYPES.includes(value.mimeType)) {
    throw new DomainError("INVALID_RECEIPT", "Unsupported receipt image type.");
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > MAX_RECEIPT_BYTES) {
    throw new DomainError("INVALID_RECEIPT", "Receipt size must be from 1 byte through 10 MiB.");
  }
  if (value.originalFilename !== undefined) assertTrimmedText(value.originalFilename, "INVALID_RECEIPT");
  isoInstant(value.createdAt);
  if (!RECEIPT_CONTENT_STATUSES.includes(value.contentStatus)) {
    throw new DomainError("INVALID_RECEIPT", "Unsupported receipt content status.");
  }
  if (value.contentRemovedAt) isoInstant(value.contentRemovedAt);
  if (value.contentRemovedByUserId) userId(value.contentRemovedByUserId);
  if (
    value.contentStatus === "available" &&
    (value.contentRemovedAt !== undefined || value.contentRemovedByUserId !== undefined)
  ) {
    throw new DomainError("INVALID_RECEIPT", "Available receipt content cannot contain removal metadata.");
  }
  if (
    value.contentStatus === "user-deleted" &&
    (!value.contentRemovedAt || !value.contentRemovedByUserId)
  ) {
    throw new DomainError("INVALID_RECEIPT", "User-deleted receipt content requires removal time and user.");
  }
  if (
    value.contentStatus === "retention-expired" &&
    (!value.contentRemovedAt || value.contentRemovedByUserId !== undefined)
  ) {
    throw new DomainError("INVALID_RECEIPT", "Retention-expired receipt content requires only a removal time.");
  }
}

export function assertAuditEvent(value: AuditEvent): void {
  auditEventId(value.auditEventId);
  householdId(value.householdId);
  userId(value.actorId);
  assertTrimmedText(value.aggregateId, "INVALID_AUDIT_EVENT");
  assertTrimmedText(value.action, "INVALID_AUDIT_EVENT");
  isoInstant(value.occurredAt);
  if (!["household", "membership", "join-request", "expense", "settlement", "card", "receipt"].includes(value.aggregateType)) {
    throw new DomainError("INVALID_AUDIT_EVENT", "Unsupported audit aggregate type.");
  }
  value.changedFields.forEach((field) => assertTrimmedText(field, "INVALID_AUDIT_EVENT"));
}
