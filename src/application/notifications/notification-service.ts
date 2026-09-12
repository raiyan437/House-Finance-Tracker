import { ApplicationError, NotificationMarkAllPartialError } from "@/application/errors/application-error";
import type { ApplicationRepositories, AtomicApplicationPersistence, CurrentSession } from "@/application/repositories";
import { NOTIFICATION_LATEST_LIMIT, NOTIFICATION_MARK_ALL_BATCH_SIZE, NOTIFICATION_MAX_OFFSET, NOTIFICATION_PAGE_SIZE, notificationRetentionCutoffAt } from "@/domain/notifications/notification-retention";
import { projectNotification, type NotificationLatestView, type NotificationMarkAllReadView, type NotificationPageView, type Notification, type NotificationView } from "@/domain/notifications/notification-types";
import type { NotificationId, UserId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";

export interface NotificationServiceDependencies {
  readonly repositories: ApplicationRepositories;
  readonly atomic: AtomicApplicationPersistence;
  readonly session: CurrentSession;
  readonly now: () => IsoInstant;
}

export class NotificationApplicationService {
  constructor(private readonly deps: NotificationServiceDependencies) {}

  private async visibleDomain(items: readonly Notification[], actor: UserId): Promise<readonly Notification[]> {
    const householdIds = [...new Set(items.filter((item) => item.scope === "household" && item.householdId).map((item) => item.householdId!))];
    const active = new Set<string>();
    await Promise.all(householdIds.map(async (householdId) => {
      const membership = await this.deps.repositories.memberships.get(householdId, actor);
      if (membership?.status === "active") active.add(householdId);
    }));
    return Object.freeze(items.filter((item) => item.scope === "account" || (item.householdId && active.has(item.householdId))));
  }

  private async visible(items: readonly Notification[], actor: UserId): Promise<readonly NotificationView[]> {
    return Object.freeze((await this.visibleDomain(items, actor)).map(projectNotification));
  }

  async latest(): Promise<NotificationLatestView> {
    const actor = await this.deps.session.getCurrentUserId();
    const cutoff = notificationRetentionCutoffAt(this.deps.now());
    const [items, unread] = await Promise.all([
      this.deps.repositories.notifications.listLatestForRecipient({ recipientUserId: actor, cutoff, limit: NOTIFICATION_LATEST_LIMIT }),
      this.deps.repositories.notifications.listUnreadForRecipient({ recipientUserId: actor, cutoff }),
    ]);
    const [notifications, visibleUnread] = await Promise.all([this.visible(items, actor), this.visible(unread, actor)]);
    return Object.freeze({ notifications, unreadCount: visibleUnread.length });
  }

  async page(offset = 0): Promise<NotificationPageView> {
    const actor = await this.deps.session.getCurrentUserId();
    if (!Number.isInteger(offset) || offset < 0 || offset > NOTIFICATION_MAX_OFFSET) throw new ApplicationError("INVALID_INPUT", "Notification pagination is outside the supported range.");
    const cutoff = notificationRetentionCutoffAt(this.deps.now());
    const raw = await this.deps.repositories.notifications.listPageForRecipient({ recipientUserId: actor, cutoff, offset, limit: NOTIFICATION_PAGE_SIZE + 1 });
    const visible = await this.visible(raw, actor);
    const hasMore = raw.length > NOTIFICATION_PAGE_SIZE;
    const notifications = visible.slice(0, NOTIFICATION_PAGE_SIZE);
    return Object.freeze({ notifications, offset, pageSize: NOTIFICATION_PAGE_SIZE, hasMore, ...(hasMore ? { nextOffset: offset + NOTIFICATION_PAGE_SIZE } : {}) });
  }

  async markAllRead(): Promise<NotificationMarkAllReadView> {
    const actor = await this.deps.session.getCurrentUserId();
    const readAt = this.deps.now();
    const cutoff = notificationRetentionCutoffAt(readAt);
    let updatedCount = 0;
    try {
      let scanOffset = 0;
      while (true) {
        const batch: Notification[] = [];
        while (batch.length < NOTIFICATION_MARK_ALL_BATCH_SIZE) {
          const unread = (await this.deps.repositories.notifications.listUnreadForRecipient({ recipientUserId: actor, cutoff, offset: scanOffset, limit: NOTIFICATION_MARK_ALL_BATCH_SIZE }))
            .filter((item) => item.createdAt >= cutoff && !item.readAt);
          const visible = await this.visibleDomain(unread, actor);
          batch.push(...visible);
          scanOffset += unread.length;
          if (unread.length < NOTIFICATION_MARK_ALL_BATCH_SIZE) break;
        }
        const selected = batch.slice(0, NOTIFICATION_MARK_ALL_BATCH_SIZE);
        if (selected.length === 0) break;
        const updated = await this.deps.atomic.markNotificationsRead({ actorId: actor, notificationIds: selected.map((item) => item.notificationId), readAt });
        updatedCount += updated;
        if (updated === 0) break;
        scanOffset = 0;
      }
    } catch (error) {
      if (updatedCount > 0) throw new NotificationMarkAllPartialError(updatedCount);
      throw error;
    }
    return Object.freeze({ updatedCount });
  }

  async markRead(id: NotificationId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    await this.deps.atomic.markNotificationRead({ actorId: actor, notificationId: id, readAt: this.deps.now() });
  }
}
