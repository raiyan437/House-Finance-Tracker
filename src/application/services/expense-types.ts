import type { ReceiptContent } from "../repositories";
import { type ExpensePercentageSourceStatus } from "@/domain/expenses/expense-percentage-source";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import {
  type Expense,
  type ExpenseComment,
  type ExpenseCardPrivateSnapshot,
} from "@/domain/records/domain-records";
import {
  type CardId,
  type ExpenseId,
  type HouseholdId,
  type ReceiptId,
  type UserId,
} from "@/domain/shared/identifiers";
import { type CommandId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import type {
  PercentageSplitEntry,
  SplitAllocation,
  SplitMethod,
} from "@/domain/splits/split-types";
import type { ExpenseDate } from "@/domain/dates/expense-date";
import { type ExpenseIconCategory } from "@/domain/expenses/expense-icon-category";
import type { PositivePoisha } from "@/domain/money/poisha";

export interface CreateExpenseCommand {
  readonly commandId?: CommandId;
  readonly backdatedConfirmationToken?: string;
  readonly householdId: HouseholdId;
  readonly name: string;
  readonly iconCategory?: ExpenseIconCategory;
  readonly amount: PositivePoisha;
  readonly expenseDate: ExpenseDate;
  readonly splitMethod: SplitMethod;
  readonly percentageEntries?: readonly PercentageSplitEntry[];
  readonly allocations: readonly SplitAllocation[];
  readonly payment:
    | { readonly method: "cash" }
    | { readonly method: "card"; readonly cardId: CardId };
  readonly receipts?: readonly Readonly<{
    originalFilename?: string;
    content: ReceiptContent;
    commandId?: CommandId;
  }>[];
}

export interface ExpenseView {
  readonly expense: Omit<Expense, "payment"> & {
    readonly payment: { readonly method: "cash" } | { readonly method: "card" };
  };
  readonly percentageSourceStatus: ExpensePercentageSourceStatus;
  /** Derived from the same Confirmed-Settlement boundary used by financial locking. */
  readonly settlementStatus: "settled" | "unsettled";
  readonly permissions: Readonly<{
    canEdit: boolean;
    canEditFinancialFields: boolean;
    canDelete: boolean;
    canReadReceipt: boolean;
    canUploadReceipt: boolean;
    canRemoveReceipt: boolean;
  }>;
  readonly financialEditability: ExpenseFinancialEditability;
  readonly privateCardSnapshot?: ExpenseCardPrivateSnapshot;
  readonly addedAfterSettlement: boolean;
  readonly commentCount?: number;
}

export interface ExpenseCommentView {
  readonly commentId: ExpenseComment["commentId"];
  readonly authorUserId: UserId;
  readonly authorDisplayName: string;
  readonly body: string;
  readonly createdAt: IsoInstant;
}

export type ExpenseFinancialEditReason =
  | "confirmed-settlement"
  | "former-member"
  | "legacy-percentage";

export interface ExpenseFinancialEditability {
  readonly state: "editable" | "locked" | "deleted";
  readonly reasons: readonly ExpenseFinancialEditReason[];
  readonly title?: string;
  readonly description?: string;
  readonly deleteDescription?: string;
}

export interface ExpenseMemberView {
  readonly userId: UserId;
  readonly displayName: string;
  readonly status: MembershipSnapshot["status"];
  readonly role: MembershipSnapshot["role"];
}

export interface ExpenseActivityView {
  readonly action: string;
  readonly actorName: string;
  readonly occurredAt: IsoInstant;
  readonly changedFields: readonly string[];
}

export interface EditExpenseCommand {
  readonly commandId?: CommandId;
  readonly backdatedConfirmationToken?: string;
  readonly expenseId: ExpenseId;
  readonly expectedRevision: number;
  readonly name: string;
  readonly iconCategory?: ExpenseIconCategory;
  readonly amount: PositivePoisha;
  readonly expenseDate: ExpenseDate;
  readonly splitMethod: SplitMethod;
  readonly percentageEntries?: readonly PercentageSplitEntry[];
  readonly allocations: readonly SplitAllocation[];
  readonly payment:
    | { readonly kind: "preserve" }
    | {
        readonly kind: "cash";
        readonly confirmedPrivateReferenceDetachment: boolean;
      }
    | { readonly kind: "card"; readonly cardId: CardId };
  readonly newReceipts?: readonly Readonly<{
    originalFilename?: string;
    content: ReceiptContent;
    commandId?: CommandId;
  }>[];
  readonly removedReceiptIds?: readonly ReceiptId[];
  /** Trusted production Receipt sagas use stable per-removal command identities. */
  readonly receiptRemovalCommandIds?: Readonly<Record<string, CommandId>>;
}
