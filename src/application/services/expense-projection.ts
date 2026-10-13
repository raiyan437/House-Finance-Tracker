import {
  isExpenseFinanciallyLocked,
  latestConfirmedSettlementAt,
} from "@/domain/expenses/confirmed-settlement-financial-lock";
import { expensePercentageSourceStatus } from "@/domain/expenses/expense-percentage-source";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { getExpensePermissions } from "@/domain/permissions/expense-permissions";
import { projectExpensePayment } from "@/domain/permissions/card-payment-privacy";
import {
  type Expense,
  type ExpenseCardPrivateSnapshot,
} from "@/domain/records/domain-records";
import { type UserId } from "@/domain/shared/identifiers";
import {
  isBackdatedAfterSettlement,
  latestConfirmedSettlementBefore,
} from "@/domain/expenses/backdated-expense-policy";
import type { ExpenseView } from "./expense-types";
import {
  projectionCardAssociationIdentity,
  financialEditability,
} from "./expense-policy";
import type { ConfirmedSettlementHistory } from "@/domain/expenses/confirmed-settlement-history";

export function projectExpenseView(
  expense: Expense,
  viewer: UserId,
  memberships: readonly MembershipSnapshot[],
  settlements: readonly import("@/domain/settlements/settlement-types").SettlementRecord[],
  snapshot?: ExpenseCardPrivateSnapshot,
  commentCount = 0,
  confirmedHistory?: ConfirmedSettlementHistory,
): ExpenseView {
  // A context belongs to exactly one household/read snapshot. Other call sites
  // keep the original individual boundary validation path.
  const indexedHistory =
    confirmedHistory?.householdId === expense.householdId
      ? confirmedHistory
      : undefined;
  const projection = projectExpensePayment(
    viewer,
    expense.creatorId,
    expense.payment,
  );
  const publicPayment =
    projection.method === "cash"
      ? { method: "cash" as const }
      : { method: "card" as const };
  const percentageSourceStatus = expensePercentageSourceStatus(
    expense.splitMethod,
    expense.percentageEntries,
  );
  const basePermissions = getExpensePermissions(
    expense.householdId,
    viewer,
    expense.creatorId,
    memberships,
  );
  const latestConfirmedAt = indexedHistory
    ? indexedHistory.latestConfirmedAt
    : latestConfirmedSettlementAt(expense.householdId, settlements);
  const settledByConfirmedHistory = isExpenseFinanciallyLocked(
    expense.createdAt,
    latestConfirmedAt,
  );
  const editability = financialEditability(
    expense,
    memberships,
    percentageSourceStatus,
    latestConfirmedAt,
    projectionCardAssociationIdentity(expense, snapshot),
  );
  const isReadOnlyHistory = editability.state === "deleted";
  const historicalBoundary = indexedHistory
    ? indexedHistory.before(expense.createdAt)
    : latestConfirmedSettlementBefore(
        expense.householdId,
        expense.createdAt,
        settlements,
      );
  const addedAfterSettlement = isBackdatedAfterSettlement(
    expense.expenseDate,
    historicalBoundary,
  );
  const canManageReceipts = viewer === expense.creatorId && !isReadOnlyHistory;
  return Object.freeze({
    expense: Object.freeze({ ...expense, payment: publicPayment }),
    percentageSourceStatus,
    settlementStatus: settledByConfirmedHistory ? "settled" : "unsettled",
    permissions: Object.freeze({
      canEdit: basePermissions.canEdit && !isReadOnlyHistory,
      canEditFinancialFields:
        basePermissions.canEdit && editability.state === "editable",
      canDelete: basePermissions.canDelete && editability.state === "editable",
      canReadReceipt: true,
      canUploadReceipt: canManageReceipts,
      canRemoveReceipt: canManageReceipts,
    }),
    financialEditability: editability,
    addedAfterSettlement,
    commentCount,
    ...(snapshot &&
    viewer === expense.creatorId &&
    expense.payment.method === "card"
      ? { privateCardSnapshot: Object.freeze({ ...snapshot }) }
      : {}),
  });
}
