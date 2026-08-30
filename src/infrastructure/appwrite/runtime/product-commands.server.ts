import "server-only";
import type { ProductRequestContext } from "./context.server";

/**
 * Trusted command surface: every function executes the unchanged application
 * service with the server-derived actor and authoritative Clock. The browser
 * supplies intent (target ids, name, correlation commandId) and nothing else.
 */
export function createHousehold(context: ProductRequestContext, name: string, code: string, commandId: string) {
  return context.application.households.createHousehold(name, code, commandId as never);
}

export function requestToJoin(context: ProductRequestContext, householdId: string, commandId: string) {
  return context.application.households.requestToJoin(householdId as never, commandId as never);
}

export function cancelJoinRequest(context: ProductRequestContext, joinRequestId: string) {
  return context.application.households.cancelJoinRequest(joinRequestId as never);
}

export function acceptJoinRequest(context: ProductRequestContext, joinRequestId: string) {
  return context.application.households.acceptJoinRequest(joinRequestId as never);
}

export function rejectJoinRequest(context: ProductRequestContext, joinRequestId: string) {
  return context.application.households.rejectJoinRequest(joinRequestId as never);
}

export function leaveHousehold(context: ProductRequestContext) {
  return context.application.households.leaveCurrentHousehold();
}

export function removeMember(context: ProductRequestContext, memberId: string) {
  return context.application.households.removeMember(memberId as never);
}

export function transferLeadership(context: ProductRequestContext, memberId: string) {
  return context.application.households.transferLeadership(memberId as never);
}

export function renameHousehold(context: ProductRequestContext, name: string) {
  return context.application.households.renameHousehold(name);
}

export function deleteHousehold(context: ProductRequestContext) {
  return context.application.households.deleteCurrentHousehold();
}

export function updateProfileDisplayName(
  context: ProductRequestContext,
  input: Readonly<{ displayName: string; expectedVersion: number; commandId: string }>,
) {
  return context.application.profiles.updateCurrentProfile(
    input.displayName,
    input.expectedVersion,
    input.commandId as never,
  );
}

export function createCard(
  context: ProductRequestContext,
  input: Readonly<{ name: string; type: "debit" | "credit"; colorId: string; commandId: string }>,
) {
  return context.application.cards.createMyCard({ ...input, colorId: input.colorId as never, commandId: input.commandId as never });
}

export function editCard(
  context: ProductRequestContext,
  cardId: string,
  input: Readonly<{ name: string; type: "debit" | "credit"; colorId: string; commandId: string }>,
) {
  return context.application.cards.updateMyCard(cardId as never, { ...input, colorId: input.colorId as never, commandId: input.commandId as never });
}

export function removeCard(context: ProductRequestContext, cardId: string, expectedAction: "delete" | "archive", commandId: string) {
  return context.application.cards.deleteOrArchiveMyCard(cardId as never, expectedAction, commandId as never);
}

export function createExpense(context: ProductRequestContext, command: Record<string, unknown>) {
  return context.application.expenses.createExpense(command as never);
}

export function editExpense(context: ProductRequestContext, command: Record<string, unknown>) {
  return context.application.expenses.editExpense(command as never);
}

export function deleteExpense(context: ProductRequestContext, expenseId: string, expectedRevision: number, commandId: string) {
  return context.application.expenses.deleteExpense(expenseId as never, expectedRevision, commandId as never);
}

export function createSettlement(context: ProductRequestContext, recommendation: Record<string, unknown>, commandId: string) {
  return context.application.settlements.createSettlement(recommendation as never, commandId as never);
}

export function transitionSettlement(
  context: ProductRequestContext,
  settlementId: string,
  status: "confirmed" | "rejected" | "cancelled",
  commandId: string,
) {
  return context.application.settlements.transitionSettlement(settlementId as never, status, commandId as never);
}
