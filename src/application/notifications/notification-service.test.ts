import { describe, expect, it, vi } from "vitest";
import type { ApplicationRepositories, AtomicApplicationPersistence, CurrentSession } from "@/application/repositories";
import { householdId, notificationId, userId, type NotificationId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { Notification } from "@/domain/notifications/notification-types";
import { notificationDraft } from "./notification-policy";
import { NotificationApplicationService } from "./notification-service";

describe("notification application service", () => {
  it("counts only retained notifications visible to the current active member", async () => {
    const actor = userId("u_actor");
    const activeHousehold = householdId("h_active");
    const formerHousehold = householdId("h_former");
    const createdAt = isoInstant("2026-09-12T03:00:00.000Z");
    const retained = Array.from({ length: 5 }, (_, index) => notificationDraft({ eventKey: `active-${index}`, recipientUserId: actor, type: "expense-created", title: `Expense ${index}`, body: `Expense ${index}`, createdAt, householdId: activeHousehold, entityType: "expense", entityId: `e_${index}` }));
    const former = notificationDraft({ eventKey: "former", recipientUserId: actor, type: "expense-created", title: "Former expense", body: "Former expense", createdAt, householdId: formerHousehold, entityType: "expense", entityId: "e_former" });
    const account = notificationDraft({ eventKey: "account", recipientUserId: actor, type: "member-left-or-removed", title: "Membership changed", body: "You were removed from the household", createdAt, accountScoped: true });
    const all = [...retained, former, account];
    const repository = {
      listLatestForRecipient: vi.fn(async () => all),
      listPageForRecipient: vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => all.slice(offset, offset + limit)),
      listUnreadForRecipient: vi.fn(async () => all),
      getForRecipient: vi.fn(),
    };
    const repositories = {
      notifications: repository,
      memberships: { get: vi.fn(async (household: typeof activeHousehold) => household === activeHousehold ? { householdId: activeHousehold, userId: actor, status: "active" as const, role: "member" as const } : undefined) },
    } as unknown as ApplicationRepositories;
    const session = { getCurrentUserId: vi.fn(async () => actor) } as unknown as CurrentSession;
    const atomic = { markNotificationRead: vi.fn() } as unknown as AtomicApplicationPersistence;
    const service = new NotificationApplicationService({ repositories, atomic, session, now: () => createdAt });

    const latest = await service.latest();
    expect(latest.notifications).toHaveLength(6);
    expect(latest.unreadCount).toBe(6);
    expect(latest.notifications.some((item) => item.title === "Former expense")).toBe(false);
    expect(latest.notifications.every((item) => !Object.prototype.hasOwnProperty.call(item, "recipientUserId"))).toBe(true);
    await service.markRead(notificationId(String(retained[0]!.notificationId)));
    expect(atomic.markNotificationRead).toHaveBeenCalledWith({ actorId: actor, notificationId: retained[0]!.notificationId, readAt: createdAt });
  });

  it.each([0, 1, 5, 6, 49, 50, 51, 101])("marks %i unread notifications in bounded batches and is idempotent", async (count) => {
    const actor = userId("u_mark_all");
    const createdAt = isoInstant("2026-09-12T03:00:00.000Z");
    let rows: Notification[] = Array.from({ length: count }, (_, index) => notificationDraft({ eventKey: `mark-all-${index}`, recipientUserId: actor, type: "member-left-or-removed", title: `Membership ${index}`, body: "You were removed from a household", createdAt, accountScoped: true }));
    const batches: NotificationId[][] = [];
    const repository = {
      listLatestForRecipient: vi.fn(async () => []),
      listPageForRecipient: vi.fn(async () => []),
      listUnreadForRecipient: vi.fn(async () => rows.filter((row) => !row.readAt)),
      getForRecipient: vi.fn(),
    };
    const atomic = {
      markNotificationRead: vi.fn(),
      markNotificationsRead: vi.fn(async ({ notificationIds, readAt }: { notificationIds: readonly NotificationId[]; readAt: typeof createdAt }) => {
        batches.push([...notificationIds]);
        let updated = 0;
        rows = rows.map((row) => {
          if (notificationIds.includes(row.notificationId) && !row.readAt) {
            updated += 1;
            return Object.freeze({ ...row, readAt });
          }
          return row;
        });
        return updated;
      }),
    };
    const session = { getCurrentUserId: vi.fn(async () => actor) } as unknown as CurrentSession;
    const service = new NotificationApplicationService({ repositories: { notifications: repository, memberships: { get: vi.fn() } } as unknown as ApplicationRepositories, atomic: atomic as unknown as AtomicApplicationPersistence, session, now: () => createdAt });

    await expect(service.markAllRead()).resolves.toEqual({ updatedCount: count });
    expect(batches.map((batch) => batch.length)).toEqual(count === 0 ? [] : Array.from({ length: Math.ceil(count / 50) }, (_, index) => Math.min(50, count - index * 50)));
    if (count > 0) expect(repository.listUnreadForRecipient).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
    await expect(service.markAllRead()).resolves.toEqual({ updatedCount: 0 });
    expect(atomic.markNotificationsRead).toHaveBeenCalledTimes(count === 0 ? 0 : Math.ceil(count / 50));
    expect(rows.every((row) => row.readAt === createdAt || count === 0)).toBe(true);
  });

  it("marks only retained notifications for the actor and leaves former-household rows hidden", async () => {
    const actor = userId("u_mark_retained");
    const household = householdId("h_mark_retained");
    const now = isoInstant("2026-09-12T03:00:00.000Z");
    const retained = [
      notificationDraft({ eventKey: "july", recipientUserId: actor, type: "expense-created", title: "July", body: "July", createdAt: isoInstant("2026-07-01T00:00:00.000Z"), householdId: household, entityType: "expense", entityId: "e_july" }),
      notificationDraft({ eventKey: "august", recipientUserId: actor, type: "expense-created", title: "August", body: "August", createdAt: isoInstant("2026-08-01T00:00:00.000Z"), householdId: household, entityType: "expense", entityId: "e_august" }),
      notificationDraft({ eventKey: "september", recipientUserId: actor, type: "expense-created", title: "September", body: "September", createdAt: now, householdId: household, entityType: "expense", entityId: "e_september" }),
      notificationDraft({ eventKey: "june", recipientUserId: actor, type: "expense-created", title: "June", body: "June", createdAt: isoInstant("2026-06-30T17:59:59.999Z"), householdId: household, entityType: "expense", entityId: "e_june" }),
      notificationDraft({ eventKey: "former", recipientUserId: actor, type: "expense-created", title: "Former", body: "Former", createdAt: now, householdId: householdId("h_former"), entityType: "expense", entityId: "e_former" }),
      notificationDraft({ eventKey: "other-user", recipientUserId: userId("u_other"), type: "expense-created", title: "Other", body: "Other", createdAt: now, householdId: household, entityType: "expense", entityId: "e_other" }),
    ];
    let rows = retained.slice();
    const atomic = { markNotificationsRead: vi.fn(async ({ notificationIds, readAt }: { notificationIds: readonly NotificationId[]; readAt: typeof now }) => {
      let updated = 0;
      rows = rows.map((row) => notificationIds.includes(row.notificationId) && !row.readAt ? Object.freeze({ ...row, readAt }) : row);
      updated = notificationIds.filter((id) => retained.some((row) => row.notificationId === id && !row.readAt)).length;
      return updated;
    }), markNotificationRead: vi.fn() };
    const repository = { listLatestForRecipient: vi.fn(async () => []), listPageForRecipient: vi.fn(async () => []), listUnreadForRecipient: vi.fn(async () => rows.filter((row) => row.recipientUserId === actor && !row.readAt)), getForRecipient: vi.fn() };
    const service = new NotificationApplicationService({ repositories: { notifications: repository, memberships: { get: vi.fn(async (id: typeof household) => id === household ? { householdId: household, userId: actor, status: "active" as const, role: "member" as const } : undefined) } } as unknown as ApplicationRepositories, atomic: atomic as unknown as AtomicApplicationPersistence, session: { getCurrentUserId: vi.fn(async () => actor) } as unknown as CurrentSession, now: () => now });

    await expect(service.markAllRead()).resolves.toEqual({ updatedCount: 3 });
    expect(atomic.markNotificationsRead.mock.calls[0]?.[0]?.notificationIds).toEqual(retained.slice(0, 3).map((row) => row.notificationId));
    expect(atomic.markNotificationsRead).toHaveBeenCalledWith(expect.objectContaining({ notificationIds: expect.arrayContaining(retained.slice(0, 3).map((row) => row.notificationId)) }));
    expect(rows.find((row) => row.title === "June")?.readAt).toBeUndefined();
    expect(rows.find((row) => row.title === "Former")?.readAt).toBeUndefined();
    expect(rows.find((row) => row.title === "Other")?.readAt).toBeUndefined();
  });

  it("surfaces a retryable partial result and safely completes the remaining batches", async () => {
    const actor = userId("u_mark_partial");
    const createdAt = isoInstant("2026-09-12T03:00:00.000Z");
    let rows: Notification[] = Array.from({ length: 101 }, (_, index) => notificationDraft({ eventKey: `partial-${index}`, recipientUserId: actor, type: "member-left-or-removed", title: `Membership ${index}`, body: "You were removed from a household", createdAt, accountScoped: true }));
    let failNext = false;
    let calls = 0;
    const atomic = {
      markNotificationRead: vi.fn(),
      markNotificationsRead: vi.fn(async ({ notificationIds, readAt }: { notificationIds: readonly NotificationId[]; readAt: typeof createdAt }) => {
        calls += 1;
        if (failNext && calls === 2) { throw new Error("provider unavailable"); }
        rows = rows.map((row) => notificationIds.includes(row.notificationId) ? Object.freeze({ ...row, readAt }) : row);
        return notificationIds.length;
      }),
    };
    const repository = { listLatestForRecipient: vi.fn(async () => []), listPageForRecipient: vi.fn(async () => []), listUnreadForRecipient: vi.fn(async () => rows.filter((row) => !row.readAt)), getForRecipient: vi.fn() };
    const service = () => new NotificationApplicationService({ repositories: { notifications: repository, memberships: { get: vi.fn() } } as unknown as ApplicationRepositories, atomic: atomic as unknown as AtomicApplicationPersistence, session: { getCurrentUserId: vi.fn(async () => actor) } as unknown as CurrentSession, now: () => createdAt });
    failNext = true;
    await expect(service().markAllRead()).rejects.toMatchObject({ code: "NOTIFICATION_PARTIAL_SUCCESS", updatedCount: 50 });
    expect(rows.filter((row) => row.readAt === createdAt)).toHaveLength(50);
    failNext = false;
    await expect(service().markAllRead()).resolves.toEqual({ updatedCount: 51 });
    expect(atomic.markNotificationsRead).toHaveBeenCalledTimes(4);
    expect(rows.every((row) => row.readAt === createdAt)).toBe(true);
  });
});
