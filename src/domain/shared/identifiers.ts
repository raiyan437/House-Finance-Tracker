import { DomainError } from "./domain-error";

declare const userIdBrand: unique symbol;
declare const householdIdBrand: unique symbol;
declare const expenseIdBrand: unique symbol;
declare const settlementIdBrand: unique symbol;

export type UserId = string & { readonly [userIdBrand]: "UserId" };
export type HouseholdId = string & {
  readonly [householdIdBrand]: "HouseholdId";
};
export type ExpenseId = string & { readonly [expenseIdBrand]: "ExpenseId" };
export type SettlementId = string & {
  readonly [settlementIdBrand]: "SettlementId";
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

export function compareUserIds(left: UserId, right: UserId): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
