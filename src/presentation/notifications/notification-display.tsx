import { Bell, ClipboardCheck, FilePlus2, MessageCircle, ReceiptText, Users, WalletCards } from "lucide-react";
import type { NotificationType } from "@/domain/notifications/notification-types";

export function notificationIcon(type: NotificationType) {
  if (type.startsWith("settlement-")) return WalletCards;
  if (type.startsWith("expense-comment")) return MessageCircle;
  if (type.startsWith("receipt-")) return ReceiptText;
  if (type.startsWith("expense-")) return FilePlus2;
  if (type === "join-request-received" || type === "member-joined" || type === "member-left-or-removed" || type === "leadership-transferred") return Users;
  return ClipboardCheck;
}

export function NotificationIcon({ type, className }: Readonly<{ type: NotificationType; className?: string }>) {
  if (type.startsWith("settlement-")) return <WalletCards aria-hidden="true" className={className} />;
  if (type.startsWith("expense-comment")) return <MessageCircle aria-hidden="true" className={className} />;
  if (type.startsWith("receipt-")) return <ReceiptText aria-hidden="true" className={className} />;
  if (type.startsWith("expense-")) return <FilePlus2 aria-hidden="true" className={className} />;
  if (type === "join-request-received" || type === "member-joined" || type === "member-left-or-removed" || type === "leadership-transferred") return <Users aria-hidden="true" className={className} />;
  return <ClipboardCheck aria-hidden="true" className={className} />;
}

export function formatNotificationTimestamp(createdAt: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }).format(new Date(createdAt));
}

export function notificationStatusLabel(readAt: string | undefined): string {
  return readAt ? "Read" : "Unread";
}

export { Bell };
