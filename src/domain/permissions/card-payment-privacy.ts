import { canonicalMemberships } from "../membership/membership-invariants";
import type { MembershipSnapshot } from "../membership/membership-types";
import { DomainError } from "../shared/domain-error";
import { userId, type HouseholdId, type UserId } from "../shared/identifiers";
import { assertCanEditExpense, getExpensePermissions } from "./expense-permissions";

export type ExpensePayment =
  | { readonly method: "cash" }
  | { readonly method: "card"; readonly cardReference: string };

export type ExpensePaymentProjection =
  | { readonly method: "cash" }
  | { readonly method: "card" }
  | { readonly method: "card"; readonly cardReference: string };

export type PaymentEditRequest =
  | { readonly kind: "preserve" }
  | {
      readonly kind: "change-to-cash";
      readonly confirmedPrivateReferenceDetachment: boolean;
    }
  | { readonly kind: "select-card"; readonly cardReference: string };

function assertCardReference(value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new DomainError(
      "PRIVATE_CARD_ACCESS_FORBIDDEN",
      "A private card reference must be a non-empty opaque value.",
    );
  }
}

export function assertExpensePayment(payment: ExpensePayment): void {
  if (payment.method === "card") assertCardReference(payment.cardReference);
}

export function projectExpensePayment(
  viewerId: UserId,
  creatorId: UserId,
  payment: ExpensePayment,
): ExpensePaymentProjection {
  userId(viewerId);
  userId(creatorId);
  assertExpensePayment(payment);
  if (payment.method === "cash") return Object.freeze({ method: "cash" });
  return viewerId === creatorId
    ? Object.freeze({
        method: "card",
        cardReference: payment.cardReference,
      })
    : Object.freeze({ method: "card" });
}

export function applyExpensePaymentEdit(
  householdId: HouseholdId,
  actorId: UserId,
  creatorId: UserId,
  memberships: readonly MembershipSnapshot[],
  currentPayment: ExpensePayment,
  request: PaymentEditRequest,
): ExpensePayment {
  assertExpensePayment(currentPayment);
  const permissions = getExpensePermissions(
    householdId,
    actorId,
    creatorId,
    memberships,
  );
  assertCanEditExpense(permissions);
  const actor = canonicalMemberships(householdId, memberships).find(
    (membership) => membership.userId === actorId,
  );
  if (!actor) {
    throw new DomainError(
      "NOT_ACTIVE_HOUSEHOLD_MEMBER",
      "The expense editor must be an active household member.",
    );
  }

  if (request.kind === "preserve") return currentPayment;
  if (request.kind === "change-to-cash") {
    if (
      currentPayment.method === "card" &&
      !request.confirmedPrivateReferenceDetachment
    ) {
      throw new DomainError(
        "PRIVATE_CARD_ACCESS_FORBIDDEN",
        "Changing Card to Cash requires explicit private-reference detachment confirmation.",
      );
    }
    return Object.freeze({ method: "cash" });
  }

  if (actorId !== creatorId) {
    throw new DomainError(
      "PRIVATE_CARD_ACCESS_FORBIDDEN",
      "A non-owner leader cannot select or change another member's card.",
    );
  }
  assertCardReference(request.cardReference);
  return Object.freeze({
    method: "card",
    cardReference: request.cardReference,
  });
}
