import { DomainError } from "./domain-error";

declare const userIdBrand: unique symbol;
declare const householdIdBrand: unique symbol;
declare const expenseIdBrand: unique symbol;
declare const settlementIdBrand: unique symbol;
declare const joinRequestIdBrand: unique symbol;
declare const cardIdBrand: unique symbol;
declare const receiptIdBrand: unique symbol;
declare const auditEventIdBrand: unique symbol;

export type UserId = string & { readonly [userIdBrand]: "UserId" };
export type HouseholdId = string & {
  readonly [householdIdBrand]: "HouseholdId";
};
export type ExpenseId = string & { readonly [expenseIdBrand]: "ExpenseId" };
export type SettlementId = string & {
  readonly [settlementIdBrand]: "SettlementId";
};
export type JoinRequestId = string & {
  readonly [joinRequestIdBrand]: "JoinRequestId";
};
export type CardId = string & { readonly [cardIdBrand]: "CardId" };
export type ReceiptId = string & { readonly [receiptIdBrand]: "ReceiptId" };
export type AuditEventId = string & {
  readonly [auditEventIdBrand]: "AuditEventId";
};

function assertOpaqueId(value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new DomainError(
      "INVALID_ID",
      "An identifier must be non-empty and must not contain outer whitespace.",
    );
  }
}
export function userId(value: string): UserId {
  assertOpaqueId(value);
  return value as UserId;
}

export function householdId(value: string): HouseholdId {
  assertOpaqueId(value);
  return value as HouseholdId;
}

export function expenseId(value: string): ExpenseId {
  assertOpaqueId(value);
  return value as ExpenseId;
}

export function settlementId(value: string): SettlementId {
  assertOpaqueId(value);
  return value as SettlementId;
}

export function joinRequestId(value: string): JoinRequestId {
  assertOpaqueId(value);
  return value as JoinRequestId;
}

export function cardId(value: string): CardId {
  assertOpaqueId(value);
  return value as CardId;
}

export function receiptId(value: string): ReceiptId {
  assertOpaqueId(value);
  return value as ReceiptId;
}

export function auditEventId(value: string): AuditEventId {
  assertOpaqueId(value);
  return value as AuditEventId;
}

export function compareUserIds(left: UserId, right: UserId): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
