import { ApplicationError } from "@/application/errors/application-error";

const MAX_ACTIVE_HOUSEHOLD_MEMBERS = 10;
export const MAX_PENDING_HOUSEHOLD_REQUESTS = 10;

export function assertActiveMemberCapacity(activeCount: number): void {
  if (activeCount >= MAX_ACTIVE_HOUSEHOLD_MEMBERS) {
    throw new ApplicationError("HOUSEHOLD_MEMBER_LIMIT_REACHED", `This household already has ${MAX_ACTIVE_HOUSEHOLD_MEMBERS} active members.`);
  }
}

export function assertPendingRequestCapacity(pendingCount: number): void {
  if (pendingCount >= MAX_PENDING_HOUSEHOLD_REQUESTS) {
    throw new ApplicationError("HOUSEHOLD_REQUEST_LIMIT_REACHED", `This household already has ${MAX_PENDING_HOUSEHOLD_REQUESTS} pending join requests. Try again after one is resolved.`);
  }
}
