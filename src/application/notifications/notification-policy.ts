import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { notificationId, type HouseholdId, type UserId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import { assertNotification, type Notification, type NotificationEntityType, type NotificationType } from "@/domain/notifications/notification-types";

function hash(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code ^ index, 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

export function deterministicNotificationId(eventKey: string, recipient: UserId, type: NotificationType): ReturnType<typeof notificationId> {
  return notificationId(`n-${hash(`${eventKey}|${recipient}|${type}`)}`);
}

export interface NotificationDraftInput {
  readonly eventKey: string;
  readonly recipientUserId: UserId;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly createdAt: IsoInstant;
  readonly householdId?: HouseholdId;
  readonly entityType?: NotificationEntityType;
  readonly entityId?: string;
  readonly accountScoped?: boolean;
}

export function notificationDraft(input: NotificationDraftInput): Notification {
  const value: Notification = {
    notificationId: deterministicNotificationId(input.eventKey, input.recipientUserId, input.type),
    recipientUserId: input.recipientUserId,
    ...(input.accountScoped ? {} : input.householdId ? { householdId: input.householdId } : {}),
    scope: input.accountScoped ? "account" : "household",
    type: input.type,
    title: input.title.trim(),
    body: input.body.trim(),
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    createdAt: input.createdAt,
  };
  assertNotification(value);
  return Object.freeze(value);
}

export function uniqueActiveRecipients(memberships: readonly MembershipSnapshot[], actorId?: UserId): readonly UserId[] {
  return Object.freeze([...new Set(memberships.filter((item) => item.status === "active" && item.userId !== actorId).map((item) => item.userId))]);
}

/**
 * Comment notifications explicitly include the Expense creator when they are
 * still an active member, then add every other active member except the
 * commenter. The Set keeps the creator from receiving a duplicate row when
 * they are also part of the general active-member audience.
 */
export function expenseCommentRecipients(input: Readonly<{
  creatorId: UserId;
  commenterId: UserId;
  memberships: readonly MembershipSnapshot[];
}>): readonly UserId[] {
  const recipients = new Set<UserId>();
  if (input.creatorId !== input.commenterId && input.memberships.some((item) => item.status === "active" && item.userId === input.creatorId)) {
    recipients.add(input.creatorId);
  }
  for (const membership of input.memberships) {
    if (membership.status === "active" && membership.userId !== input.commenterId) recipients.add(membership.userId);
  }
  return Object.freeze([...recipients]);
}

export function formatNotificationBdt(amountPoisha: number): string {
  const value = BigInt(amountPoisha);
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const taka = absolute / BigInt(100);
  const poisha = absolute % BigInt(100);
  const grouped = taka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}৳${grouped}.${poisha.toString().padStart(2, "0")}`;
}
