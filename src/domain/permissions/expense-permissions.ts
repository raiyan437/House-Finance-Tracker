import { canonicalMemberships } from "../membership/membership-invariants";
import type { MembershipSnapshot } from "../membership/membership-types";
import { DomainError } from "../shared/domain-error";
import { userId, type HouseholdId, type UserId } from "../shared/identifiers";

export interface ExpensePermissions {
  readonly canView: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

export function getExpensePermissions(
  householdId: HouseholdId,
  actorId: UserId,
  creatorId: UserId,
  memberships: readonly MembershipSnapshot[],
): ExpensePermissions {
  userId(actorId);
  userId(creatorId);
  const canonical = canonicalMemberships(householdId, memberships);
  if (!canonical.some((membership) => membership.userId === creatorId)) {
    throw new DomainError(
      "INVALID_EXPENSE_LEDGER_ENTRY",
      "An expense creator must exist in household history.",
    );
  }
  const actor = canonical.find(
    (membership) => membership.userId === actorId,
  );
  if (!actor || actor.status !== "active") {
    return Object.freeze({ canView: false, canEdit: false, canDelete: false });
  }

  const canManage = actorId === creatorId || actor.role === "leader";
  return Object.freeze({
    canView: true,
    canEdit: canManage,
    canDelete: canManage,
  });
}

export function assertCanViewExpense(permissions: ExpensePermissions): void {
  if (!permissions.canView) {
    throw new DomainError(
      "EXPENSE_VIEW_FORBIDDEN",
      "Only active household members may view household expenses.",
    );
  }
}

export function assertCanEditExpense(permissions: ExpensePermissions): void {
  if (!permissions.canEdit) {
    throw new DomainError(
      "EXPENSE_EDIT_FORBIDDEN",
      "Only the expense creator or household leader may edit an expense.",
    );
  }
}

export function assertCanDeleteExpense(permissions: ExpensePermissions): void {
  if (!permissions.canDelete) {
    throw new DomainError(
      "EXPENSE_DELETE_FORBIDDEN",
      "Only the expense creator or household leader may delete an expense.",
    );
  }
}
