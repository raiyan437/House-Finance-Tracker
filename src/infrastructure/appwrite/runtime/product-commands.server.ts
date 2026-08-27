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
