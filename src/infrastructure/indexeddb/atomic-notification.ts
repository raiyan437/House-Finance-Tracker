import { ApplicationError } from "@/application/errors/application-error";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { persistenceFailure } from "./repositories";
import { IndexedDbCommandContext, abortSafely } from "./atomic-context";

/** notification commands retain their original complete transaction boundaries. */
export class IndexedDbNotificationCommands implements Pick<AtomicApplicationPersistence, "markNotificationRead" | "markNotificationsRead"> {
  constructor(private readonly context: IndexedDbCommandContext) {}

async markNotificationRead(input: Parameters<AtomicApplicationPersistence["markNotificationRead"]>[0]): Promise<void> {
    const tx = (await this.context.db()).transaction("notifications", "readwrite");
    try {
      const raw = await tx.store.get(input.notificationId);
      if (!raw || raw.recipientUserId !== input.actorId) throw new ApplicationError("NOT_FOUND", "Notification not found.");
      if (raw.readAt === null) await tx.store.put({ ...raw, readAt: input.readAt });
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async markNotificationsRead(input: Parameters<AtomicApplicationPersistence["markNotificationsRead"]>[0]): Promise<number> {
    if (input.notificationIds.length > 50) throw new ApplicationError("INVALID_INPUT", "Notification batches are limited to 50 rows.");
    const tx = (await this.context.db()).transaction("notifications", "readwrite");
    try {
      let updated = 0;
      for (const notificationIdValue of new Set(input.notificationIds)) {
        const raw = await tx.store.get(notificationIdValue);
        if (!raw) continue;
        if (raw.recipientUserId !== input.actorId) throw new ApplicationError("NOT_FOUND", "Notification not found.");
        if (raw.readAt === null) {
          await tx.store.put({ ...raw, readAt: input.readAt });
          updated += 1;
        }
      }
      await tx.done;
      return updated;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }
}
