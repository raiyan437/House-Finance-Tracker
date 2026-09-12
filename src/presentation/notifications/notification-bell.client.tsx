"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { notificationHref } from "@/application/notifications/notification-routes";
import type { NotificationLatestView, NotificationView } from "@/domain/notifications/notification-types";
import { expenseId } from "@/domain/shared/identifiers";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { Bell, formatNotificationTimestamp, NotificationIcon, notificationStatusLabel } from "./notification-display";

function NotificationItem({ notification, onOpen }: Readonly<{ notification: NotificationView; onOpen: (notification: NotificationView) => void }>) {
  return (
    <DropdownMenuItem asChild className="h-auto min-h-16 items-start whitespace-normal px-3 py-2">
      <button aria-label={`${notification.title}, ${notificationStatusLabel(notification.readAt)}`} className={`w-full text-left ${notification.readAt ? "" : "bg-secondary/60"}`} onClick={() => onOpen(notification)} type="button">
        <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><NotificationIcon className="size-4" type={notification.type} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2"><span className="line-clamp-1 flex-1 font-medium">{notification.title}</span>{notification.readAt ? null : <span aria-label="Unread" className="mt-1 size-2 shrink-0 rounded-full bg-primary" />}</span>
          <span className="mt-0.5 block line-clamp-2 text-xs text-text-secondary">{notification.body}</span>
          <span className="mt-1 block text-[11px] text-text-muted">{formatNotificationTimestamp(notification.createdAt)}</span>
        </span>
      </button>
    </DropdownMenuItem>
  );
}

export function NotificationBell() {
  const router = useRouter();
  const runtime = useApplicationRuntime();
  const [data, setData] = useState<NotificationLatestView>({ notifications: [], unreadCount: 0 });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState(false);
  const actions = runtime.status === "ready" ? runtime.notificationActions : undefined;

  useEffect(() => {
    if (!actions) return;
    let active = true;
    void actions.latest().then((next) => { if (active) { setData(next); setLoading(false); } }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [actions]);

  useEffect(() => {
    if (!open || !actions) return;
    void actions.latest().then(setData).catch(() => undefined);
  }, [actions, open]);

  const openNotification = async (notification: NotificationView) => {
    setOpen(false);
    if (!notification.readAt && actions) {
      await actions.markRead(notification.notificationId).catch(() => undefined);
      setData((current) => ({ ...current, unreadCount: Math.max(0, current.unreadCount - 1), notifications: current.notifications.map((item) => item.notificationId === notification.notificationId ? { ...item, readAt: notification.createdAt } : item) }));
    }
    let href = notificationHref(notification);
    if (notification.entityId && (notification.entityType === "expense" || notification.entityType === "expense-comment" || notification.entityType === "receipt") && runtime.status === "ready") {
      try {
        await runtime.expenseActions.getExpense(expenseId(notification.entityId));
      } catch {
        href = "/expenses";
      }
    }
    router.push(href);
  };

  const markAllRead = async () => {
    if (!actions || data.unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    setMarkAllError(false);
    try {
      await actions.markAllRead();
      setData(await actions.latest());
    } catch {
      setMarkAllError(true);
      await actions.latest().then(setData).catch(() => undefined);
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>
        <Button aria-expanded={open} aria-label={data.unreadCount > 0 ? `Notifications, ${data.unreadCount} unread` : "Notifications"} className="relative size-11 rounded-xl" size="icon" variant="ghost">
          <Bell aria-hidden="true" className="size-5" />
          {data.unreadCount > 0 ? <span aria-label={`${data.unreadCount} unread notifications`} className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{data.unreadCount > 99 ? "99+" : data.unreadCount}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(30rem,calc(100dvh-2rem))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto p-1">
        <div className="flex items-center justify-between gap-2 px-3 py-2"><p className="text-sm font-semibold">Notifications</p>{data.unreadCount > 0 ? <Button aria-busy={markingAll} className="min-h-11 shrink-0 px-2 text-xs" disabled={markingAll} onClick={() => void markAllRead()} title="Mark all notifications as read" type="button" variant="ghost">{markingAll ? "Marking…" : "Mark all as read"}</Button> : <span className="text-xs text-text-muted">{loading ? "Loading…" : "All caught up"}</span>}</div>
        {markAllError ? <p className="px-3 pb-2 text-xs text-danger" role="alert">Some notifications may still be unread. Please retry.</p> : null}
        <DropdownMenuSeparator />
        {data.notifications.length === 0 ? <p className="px-3 py-6 text-center text-sm text-text-secondary">No notifications yet.</p> : data.notifications.map((notification) => <NotificationItem key={notification.notificationId} notification={notification} onOpen={openNotification} />)}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="justify-center font-medium text-primary"><Link href="/notifications">See more</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
