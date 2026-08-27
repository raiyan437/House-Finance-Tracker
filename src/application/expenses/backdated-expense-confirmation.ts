import { canonicalIntent } from "../idempotency/command-idempotency";
import type { CommandId, SettlementId, UserId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import type { ExpenseDate } from "@/domain/dates/expense-date";
import type { PositivePoisha } from "@/domain/money/poisha";
import type { PercentageSplitEntry, SplitAllocation, SplitMethod } from "@/domain/splits/split-types";

export interface BackdatedExpenseConfirmationPayload {
  readonly actorId: UserId;
  readonly commandType: "create-expense" | "edit-expense";
  readonly commandId: CommandId;
  readonly relevantIntentDigest: string;
  readonly proposedExpenseDate: ExpenseDate;
  readonly qualifyingSettlementId: SettlementId;
  readonly qualifyingSettlementResolvedAt: IsoInstant;
}

export interface BackdatedExpenseConfirmationAuthority {
  issue(payload: BackdatedExpenseConfirmationPayload): string;
  verify(token: string, payload: BackdatedExpenseConfirmationPayload): boolean;
}

function localOpaqueDigest(value: string): string {
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  const mask = BigInt("18446744073709551615");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function expenseRelevantIntentDigest(input: Readonly<{
  amount: PositivePoisha;
  expenseDate: ExpenseDate;
  splitMethod: SplitMethod;
  percentageEntries?: readonly PercentageSplitEntry[];
  allocations: readonly SplitAllocation[];
  paymentMethod: "cash" | "card";
  cardAssociationIdentity?: string;
}>): string {
  return localOpaqueDigest(canonicalIntent(input));
}

/** Local semantic token only. Phase 13 replaces this with a server-secret HMAC. */
export function localBackdatedConfirmationToken(
  payload: BackdatedExpenseConfirmationPayload,
): string {
  return `local-backdated-v1.${localOpaqueDigest(canonicalIntent(payload))}`;
}

export const LOCAL_BACKDATED_CONFIRMATION_AUTHORITY: BackdatedExpenseConfirmationAuthority = Object.freeze({
  issue: localBackdatedConfirmationToken,
  verify: (token: string, payload: BackdatedExpenseConfirmationPayload) => token === localBackdatedConfirmationToken(payload),
});
