import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { notificationDraft } from "@/application/notifications/notification-policy";
import { householdId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { notificationRetentionCutoffAt } from "@/domain/notifications/notification-retention";
import { IndexedDbAtomicApplicationPersistence } from "./atomic-persistence";
import { deleteLocalDatabase, openLocalDatabase } from "./database";
import { toNotificationRecord } from "./mappers";
import { IndexedDbNotificationRepository } from "./repositories";

describe("IndexedDB notification provider parity", () => {
  it("supports retained ordering, bounded pagination, unread lookup, and recipient-safe read state", async () => {
    const name = `notifications-${crypto.randomUUID()}`;
    const db = await openLocalDatabase(name);
    const actor = userId("u_actor");
    const other = userId("u_other");
    const household = householdId("h_home");
    const now = isoInstant("2026-09-12T03:00:00.000Z");
    const cutoff = notificationRetentionCutoffAt(now);
    const retained = Array.from({ length: 7 }, (_, index) => notificationDraft({ eventKey: `retained-${index}`, recipientUserId: actor, type: "expense-created", title: `Expense ${index}`, body: `Raiyan added Expense ${index}`, createdAt: isoInstant(`2026-09-${String(12 - index).padStart(2, "0")}T03:00:00.000Z`), householdId: household, entityType: "expense", entityId: `e_${index}` }));
    const old = notificationDraft({ eventKey: "old", recipientUserId: actor, type: "expense-created", title: "Old", body: "Old notification", createdAt: isoInstant("2026-06-30T17:59:59.999Z"), householdId: household, entityType: "expense", entityId: "e_old" });
    const foreign = notificationDraft({ eventKey: "foreign", recipientUserId: other, type: "expense-created", title: "Foreign", body: "Foreign notification", createdAt: retained[0]!.createdAt, householdId: household, entityType: "expense", entityId: "e_foreign" });
    for (const row of [...retained, old, foreign]) await db.add("notifications", toNotificationRecord(row));
    const repository = new IndexedDbNotificationRepository(db);

    await expect(repository.listLatestForRecipient({ recipientUserId: actor, cutoff, limit: 5 })).resolves.toHaveLength(5);
    await expect(repository.listPageForRecipient({ recipientUserId: actor, cutoff, offset: 5, limit: 50 })).resolves.toMatchObject([{ title: "Expense 5" }, { title: "Expense 6" }]);
    await expect(repository.listUnreadForRecipient({ recipientUserId: actor, cutoff })).resolves.toHaveLength(7);
    await expect(repository.getForRecipient(foreign.notificationId, actor)).resolves.toBeUndefined();

    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    await atomic.markNotificationRead({ actorId: actor, notificationId: retained[0]!.notificationId, readAt: now });
    await atomic.markNotificationRead({ actorId: actor, notificationId: retained[0]!.notificationId, readAt: isoInstant("2026-09-12T04:00:00.000Z") });
    await expect(repository.listUnreadForRecipient({ recipientUserId: actor, cutoff })).resolves.toHaveLength(6);
    await expect(atomic.markNotificationRead({ actorId: actor, notificationId: foreign.notificationId, readAt: now })).rejects.toMatchObject({ code: "NOT_FOUND" });

    db.close();
    await deleteLocalDatabase(name);
  });

  it("enforces the 50-row provider batch ceiling and makes retries idempotent", async () => {
    const name = `notifications-batch-${crypto.randomUUID()}`;
    const db = await openLocalDatabase(name);
    const actor = userId("u_batch_actor");
    const other = userId("u_batch_other");
    const now = isoInstant("2026-09-12T03:00:00.000Z");
    const rows = Array.from({ length: 51 }, (_, index) => notificationDraft({
      eventKey: `batch-${index}`, recipientUserId: actor, type: "member-left-or-removed",
      title: `Membership ${index}`, body: "You were removed from a household", createdAt: now, accountScoped: true,
    }));
    const foreign = notificationDraft({ eventKey: "batch-foreign", recipientUserId: other, type: "member-left-or-removed", title: "Foreign", body: "Foreign", createdAt: now, accountScoped: true });
    for (const row of [...rows, foreign]) await db.add("notifications", toNotificationRecord(row));
    const atomic = new IndexedDbAtomicApplicationPersistence(db);

    await expect(atomic.markNotificationsRead({ actorId: actor, notificationIds: rows.map((row) => row.notificationId), readAt: now })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(atomic.markNotificationsRead({ actorId: actor, notificationIds: rows.slice(0, 50).map((row) => row.notificationId), readAt: now })).resolves.toBe(50);
    await expect(atomic.markNotificationsRead({ actorId: actor, notificationIds: rows.slice(50).map((row) => row.notificationId), readAt: now })).resolves.toBe(1);
    await expect(atomic.markNotificationsRead({ actorId: actor, notificationIds: rows.map((row) => row.notificationId), readAt: isoInstant("2026-09-12T04:00:00.000Z") })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(atomic.markNotificationsRead({ actorId: actor, notificationIds: rows.slice(0, 50).map((row) => row.notificationId), readAt: isoInstant("2026-09-12T04:00:00.000Z") })).resolves.toBe(0);
    await expect(atomic.markNotificationsRead({ actorId: actor, notificationIds: [foreign.notificationId], readAt: now })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const repository = new IndexedDbNotificationRepository(db);
    await expect(repository.listUnreadForRecipient({ recipientUserId: actor, cutoff: notificationRetentionCutoffAt(now) })).resolves.toHaveLength(0);
    await expect(repository.getForRecipient(foreign.notificationId, actor)).resolves.toBeUndefined();
    db.close();
    await deleteLocalDatabase(name);
  });
});
