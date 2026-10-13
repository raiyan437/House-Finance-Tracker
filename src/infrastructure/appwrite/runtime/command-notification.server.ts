import "server-only";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { ApplicationError } from "@/application/errors/application-error";
import { runCommandTransaction } from "./tx-runner.server";
import { mapNotification } from "../reads/mappers.server";
import { AppwriteCommandContext, TABLE } from "./command-context.server";

/** notification commands retain their original complete transaction boundaries. */
export class AppwriteNotificationCommands implements Pick<AtomicApplicationPersistence, "markNotificationRead" | "markNotificationsRead"> {
  constructor(private readonly context: AppwriteCommandContext) {}

// -- R4 placeholders -----------------------------------------------------

  async markNotificationRead(input: Parameters<AtomicApplicationPersistence["markNotificationRead"]>[0]): Promise<void> {
    await runCommandTransaction(this.context.tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(this.context.tablesDB, tx);
      const raw = await tables.getRow(TABLE.notifications, String(input.notificationId));
      const notification = raw ? mapNotification(raw) : undefined;
      if (!notification || notification.recipientUserId !== input.actorId) throw new ApplicationError("NOT_FOUND", "Notification not found.");
      if (notification.readAt) return;
      await this.context.tablesDB.updateRow({ databaseId: "hft", tableId: TABLE.notifications, rowId: String(input.notificationId), data: { readAt: input.readAt }, transactionId: tx.id });
      tx.recordStagedOperation();
    });
  }

async markNotificationsRead(input: Parameters<AtomicApplicationPersistence["markNotificationsRead"]>[0]): Promise<number> {
    if (input.notificationIds.length > 50) throw new ApplicationError("INVALID_INPUT", "Notification batches are limited to 50 rows.");
    return runCommandTransaction(this.context.tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(this.context.tablesDB, tx);
      let updated = 0;
      for (const notificationIdValue of new Set(input.notificationIds.map(String))) {
        const raw = await tables.getRow(TABLE.notifications, notificationIdValue);
        const notification = raw ? mapNotification(raw) : undefined;
        if (!notification) continue;
        if (notification.recipientUserId !== input.actorId) throw new ApplicationError("NOT_FOUND", "Notification not found.");
        if (notification.readAt) continue;
        await this.context.tablesDB.updateRow({ databaseId: "hft", tableId: TABLE.notifications, rowId: notificationIdValue, data: { readAt: input.readAt }, transactionId: tx.id });
        tx.recordStagedOperation();
        updated += 1;
      }
      return updated;
    });
  }
}
