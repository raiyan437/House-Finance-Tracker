import type { HouseholdId, NotificationId, UserId } from "../shared/identifiers";
import { notificationId } from "../shared/identifiers";
import { DomainError } from "../shared/domain-error";
import { isoInstant, type IsoInstant } from "../shared/instant";

export const NOTIFICATION_TYPES = [
  "join-request-received",
  "join-request-accepted",
  "join-request-rejected",
  "member-joined",
  "member-left-or-removed",
  "leadership-transferred",
  "household-renamed",
  "expense-created",
  "expense-materially-updated",
  "expense-deleted",
  "expense-comment-added",
  "receipt-added",
  "receipt-removed",
  "settlement-requested",
  "settlement-confirmed",
  "settlement-rejected",
  "settlement-cancelled",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_SCOPES = ["account", "household"] as const;
export type NotificationScope = (typeof NOTIFICATION_SCOPES)[number];
export const NOTIFICATION_ENTITY_TYPES = [
  "household", "join-request", "membership", "expense", "expense-comment", "receipt", "settlement",
] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export const NOTIFICATION_TITLE_MAX_LENGTH = 120;
export const NOTIFICATION_BODY_MAX_LENGTH = 240;

export interface Notification {
  readonly notificationId: NotificationId;
  readonly recipientUserId: UserId;
  readonly householdId?: HouseholdId;
  readonly scope: NotificationScope;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly entityType?: NotificationEntityType;
  readonly entityId?: string;
  readonly createdAt: IsoInstant;
  readonly readAt?: IsoInstant;
}

export interface NotificationView {
  readonly notificationId: NotificationId;
  readonly scope: NotificationScope;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly entityType?: NotificationEntityType;
  readonly entityId?: string;
  readonly createdAt: IsoInstant;
  readonly readAt?: IsoInstant;
}

export interface NotificationLatestView {
  readonly notifications: readonly NotificationView[];
  readonly unreadCount: number;
}

export interface NotificationPageView {
  readonly notifications: readonly NotificationView[];
  readonly offset: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
  readonly nextOffset?: number;
}

export interface NotificationMarkAllReadView {
  readonly updatedCount: number;
}

export function assertNotification(value: Notification): void {
  if (value.notificationId !== notificationId(String(value.notificationId))) throw new DomainError("INVALID_ID", "Notification identity is invalid.");
  if (!value.recipientUserId || !value.createdAt) throw new DomainError("INVALID_NOTIFICATION", "Notification identity and timestamp are required.");
  if (!NOTIFICATION_SCOPES.includes(value.scope) || !NOTIFICATION_TYPES.includes(value.type)) throw new DomainError("INVALID_NOTIFICATION", "Notification scope or type is invalid.");
  if (value.scope === "household" && !value.householdId) throw new DomainError("INVALID_NOTIFICATION", "Household notifications require a Household.");
  if (value.scope === "account" && value.householdId) throw new DomainError("INVALID_NOTIFICATION", "Account notifications cannot carry a Household resource.");
  if (value.title.trim() !== value.title || value.body.trim() !== value.body || value.title.length > NOTIFICATION_TITLE_MAX_LENGTH || value.body.length > NOTIFICATION_BODY_MAX_LENGTH) throw new DomainError("INVALID_NOTIFICATION", "Notification content is outside its bounded snapshot limits.");
  if (value.entityType && !NOTIFICATION_ENTITY_TYPES.includes(value.entityType)) throw new DomainError("INVALID_NOTIFICATION", "Notification entity type is invalid.");
  isoInstant(value.createdAt);
  if (value.readAt) isoInstant(value.readAt);
}

export function projectNotification(value: Notification): NotificationView {
  assertNotification(value);
  return Object.freeze({
    notificationId: value.notificationId,
    scope: value.scope,
    type: value.type,
    title: value.title,
    body: value.body,
    ...(value.entityType ? { entityType: value.entityType } : {}),
    ...(value.entityId ? { entityId: value.entityId } : {}),
    createdAt: value.createdAt,
    ...(value.readAt ? { readAt: value.readAt } : {}),
  });
}
