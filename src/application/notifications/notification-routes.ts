import type { NotificationView } from "@/domain/notifications/notification-types";

export function notificationHref(notification: Pick<NotificationView, "type" | "entityType" | "entityId">): string {
  if (notification.entityId && (notification.entityType === "expense" || notification.entityType === "expense-comment" || notification.entityType === "receipt")) return `/expenses/${encodeURIComponent(notification.entityId)}`;
  if (notification.type.startsWith("settlement-")) return "/settlements";
  return "/household";
}
