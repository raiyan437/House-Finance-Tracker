"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/presentation/components/async-state";
import { PageContainer } from "@/presentation/shell/page-container";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { notificationHref } from "@/application/notifications/notification-routes";
import type { NotificationPageView, NotificationView } from "@/domain/notifications/notification-types";
import { expenseId } from "@/domain/shared/identifiers";
import { formatNotificationTimestamp, NotificationIcon, notificationStatusLabel } from "./notification-display";

export function NotificationsPageClient() {
  const router = useRouter();
  const runtime = useApplicationRuntime();
  const actions = runtime.status === "ready" ? runtime.notificationActions : undefined;
  const [pages, setPages] = useState<NotificationPageView | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState(false);

  useEffect(() => {
    if (!actions) return;
    let active = true;
    void actions.page(0).then((page) => { if (active) { setPages(page); setLoading(false); } }).catch(() => { if (active) { setError(true); setLoading(false); } });
    void actions.latest().then((latest) => { if (active) setUnreadCount(latest.unreadCount); }).catch(() => undefined);
    return () => { active = false; };
  }, [actions]);

  if (loading) return <PageContainer><LoadingState label="Loading Notifications" /></PageContainer>;
  if (error || !pages) return <PageContainer><ErrorState description="Notifications could not be loaded right now." onRetry={() => window.location.reload()} title="Notifications unavailable" /></PageContainer>;

  const loadMore = async () => {
    if (!actions || !pages.hasMore || pages.nextOffset === undefined) return;
    const next = await actions.page(pages.nextOffset);
    setPages((current) => current ? { ...next, notifications: [...current.notifications, ...next.notifications] } : next);
  };

  const refreshLoadedPages = async (loadedCount: number) => {
    if (!actions || !pages) return;
    const offsets = Array.from({ length: Math.max(1, Math.ceil(loadedCount / pages.pageSize)) }, (_, index) => index * pages.pageSize);
    const refreshed = await Promise.all(offsets.map((offset) => actions.page(offset)));
    const last = refreshed[refreshed.length - 1];
    if (!last) return;
    setPages({
      notifications: refreshed.flatMap((page) => page.notifications).slice(0, loadedCount),
      offset: 0,
      pageSize: pages.pageSize,
      hasMore: last.hasMore,
      ...(last.hasMore && last.nextOffset !== undefined ? { nextOffset: last.nextOffset } : {}),
    });
  };

  const markAllRead = async () => {
    if (!actions || unreadCount === 0 || markingAll) return;
    const loadedCount = pages?.notifications.length ?? 0;
    setMarkingAll(true);
    setMarkAllError(false);
    try {
      await actions.markAllRead();
      const latest = await actions.latest();
      setUnreadCount(latest.unreadCount);
      await refreshLoadedPages(loadedCount);
    } catch {
      setMarkAllError(true);
      await actions.latest().then((latest) => setUnreadCount(latest.unreadCount)).catch(() => undefined);
      await refreshLoadedPages(loadedCount).catch(() => undefined);
    } finally {
      setMarkingAll(false);
    }
  };

  const openNotification = async (notification: NotificationView) => {
    if (!notification.readAt && actions) await actions.markRead(notification.notificationId).catch(() => undefined);
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

  return (
    <PageContainer className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-h1 font-semibold tracking-tight">Notifications</h1><p className="mt-1 text-body text-text-secondary">Recent household activity from the current and previous two Dhaka calendar months.</p></div>{unreadCount > 0 ? <Button aria-busy={markingAll} className="min-h-11 shrink-0" disabled={markingAll} onClick={() => void markAllRead()} type="button" variant="outline">{markingAll ? "Marking…" : "Mark all as read"}</Button> : null}</div>
      {markAllError ? <p className="text-sm text-danger" role="alert">Some notifications may still be unread. Please retry.</p> : null}
      {pages.notifications.length === 0 ? <div className="rounded-2xl border border-dashed px-6 py-16 text-center"><p className="font-medium">No notifications yet</p><p className="mt-2 text-sm text-text-secondary">New household activity will appear here.</p></div> : <div className="overflow-hidden rounded-2xl border"><div className="divide-y">{pages.notifications.map((notification) => <NotificationPageItem key={notification.notificationId} notification={notification} onOpen={openNotification} />)}</div></div>}
      {pages.hasMore ? <div className="flex justify-center"><Button className="min-h-11" onClick={() => void loadMore()} variant="outline">Load more</Button></div> : null}
    </PageContainer>
  );
}

function NotificationPageItem({ notification, onOpen }: Readonly<{ notification: NotificationView; onOpen: (notification: NotificationView) => void }>) {
  return <button aria-label={`${notification.title}, ${notificationStatusLabel(notification.readAt)}`} className={`flex min-h-20 w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${notification.readAt ? "" : "bg-secondary/50"}`} onClick={() => onOpen(notification)} type="button"><span aria-hidden="true" className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><NotificationIcon className="size-4" type={notification.type} /></span><span className="min-w-0 flex-1"><span className="flex items-start gap-2"><span className="font-medium">{notification.title}</span>{notification.readAt ? <span className="sr-only">Read</span> : <><span className="mt-2 size-2 shrink-0 rounded-full bg-primary" /><span className="sr-only">Unread</span></>}</span><span className="mt-1 block break-words text-sm text-text-secondary">{notification.body}</span><span className="mt-1 block text-xs text-text-muted">{formatNotificationTimestamp(notification.createdAt)}</span></span></button>;
}
