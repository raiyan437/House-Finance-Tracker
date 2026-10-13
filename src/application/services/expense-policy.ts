import { BackdatedExpenseConfirmationRequiredError } from "../errors/application-error";
import {
  LOCAL_BACKDATED_CONFIRMATION_AUTHORITY,
  type BackdatedExpenseConfirmationPayload,
} from "../expenses/backdated-expense-confirmation";
import { isExpenseFinanciallyLocked } from "@/domain/expenses/confirmed-settlement-financial-lock";
import {
  expenseInvolvesFormerMember,
  type ExpenseFinancialFingerprint,
} from "@/domain/expenses/expense-financial-fingerprint";
import { type ExpensePercentageSourceStatus } from "@/domain/expenses/expense-percentage-source";
import { DomainError } from "@/domain/shared/domain-error";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import {
  type Expense,
  type ExpenseCardPrivateSnapshot,
} from "@/domain/records/domain-records";
import { type ExpenseId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import { type Dependencies } from "./service-context";
import type {
  ExpenseFinancialEditReason,
  ExpenseFinancialEditability,
} from "./expense-types";

export function requireBackdatedConfirmation(
  deps: Dependencies,
  payload: BackdatedExpenseConfirmationPayload,
  providedToken: string | undefined,
): void {
  const authority =
    deps.backdatedConfirmationAuthority ??
    LOCAL_BACKDATED_CONFIRMATION_AUTHORITY;
  if (!providedToken || !authority.verify(providedToken, payload)) {
    throw new BackdatedExpenseConfirmationRequiredError(
      authority.issue(payload),
    );
  }
}

export function expensePrivateReference(id: ExpenseId): string {
  return `private:${id}`;
}

export function financialFingerprint(
  expense: Expense,
  cardAssociationIdentity?: string,
): ExpenseFinancialFingerprint {
  return {
    householdId: expense.householdId,
    amount: expense.amount,
    payerId: expense.payerId,
    splitMethod: expense.splitMethod,
    percentageEntries: expense.percentageEntries,
    allocations: expense.allocations,
    expenseDate: expense.expenseDate,
    payment: expense.payment,
    ...(expense.payment.method === "card" ? { cardAssociationIdentity } : {}),
    deleted: Boolean(expense.deletedAt),
  };
}

export function projectionCardAssociationIdentity(
  expense: Expense,
  snapshot?: ExpenseCardPrivateSnapshot,
): string | undefined {
  if (expense.payment.method === "cash") return undefined;
  return snapshot?.cardId ?? expense.payment.cardReference;
}

export function financialEditability(
  expense: Expense,
  memberships: readonly MembershipSnapshot[],
  percentageSourceStatus: ExpensePercentageSourceStatus,
  latestConfirmedAt: IsoInstant | undefined,
  cardAssociationIdentity: string | undefined,
): ExpenseFinancialEditability {
  const fingerprint = financialFingerprint(expense, cardAssociationIdentity);
  const reasons: ExpenseFinancialEditReason[] = [];
  if (isExpenseFinanciallyLocked(expense.createdAt, latestConfirmedAt)) {
    reasons.push("confirmed-settlement");
  }
  if (expenseInvolvesFormerMember(fingerprint, memberships)) {
    reasons.push("former-member");
  }
  if (percentageSourceStatus === "legacy-percentage-input-unavailable") {
    reasons.push("legacy-percentage");
  }

  if (expense.deletedAt) {
    return Object.freeze({
      state: "deleted",
      reasons: Object.freeze(reasons),
    });
  }
  if (reasons.length === 0) {
    return Object.freeze({ state: "editable", reasons: Object.freeze([]) });
  }

  if (reasons.includes("confirmed-settlement")) {
    return Object.freeze({
      state: "locked",
      reasons: Object.freeze(reasons),
      title: "Financial details are locked",
      description:
        "This expense existed before a household settlement was confirmed. Changing its financial details could alter balances that have already been settled.",
      deleteDescription:
        "This expense is part of settled financial history and can no longer be deleted.",
    });
  }
  if (reasons.includes("former-member")) {
    return Object.freeze({
      state: "locked",
      reasons: Object.freeze(reasons),
      title: "Financial details are locked",
      description:
        "This expense includes a former member, so its financial history can no longer be changed.",
    });
  }
  return Object.freeze({
    state: "locked",
    reasons: Object.freeze(reasons),
    title: "Financial details are locked",
    description:
      "The original percentage inputs are unavailable, so the saved financial details cannot be changed.",
  });
}

export function assertExpenseParticipantsBelongToHousehold(
  expense: Expense,
  memberships: readonly MembershipSnapshot[],
  requireActive: boolean,
): void {
  const membershipByUserId = new Map(
    memberships
      .filter((membership) => membership.householdId === expense.householdId)
      .map((membership) => [membership.userId, membership]),
  );
  for (const allocation of expense.allocations) {
    const membership = membershipByUserId.get(allocation.participantId);
    if (!membership || (requireActive && membership.status !== "active")) {
      throw new DomainError(
        "INVALID_EXPENSE",
        requireActive
          ? "New expense participants must be active household members."
          : "Expense participants must belong to household history.",
      );
    }
  }
}
