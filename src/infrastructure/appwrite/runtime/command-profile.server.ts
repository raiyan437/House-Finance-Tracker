import "server-only";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { ApplicationError } from "@/application/errors/application-error";
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from "@/domain/records/domain-records";
import { mapProfileDisplay } from "../reads/mappers.server";
import { runCommandTransaction } from "./tx-runner.server";
import { AppwriteCommandContext, TABLE } from "./command-context.server";

/** profile commands retain their original complete transaction boundaries. */
export class AppwriteProfileCommands implements Pick<AtomicApplicationPersistence, "updateCurrentProfile"> {
  constructor(private readonly context: AppwriteCommandContext) {}

// -- v1.1 Profile Display Name ------------------------------------------

  async updateCurrentProfile(input: Parameters<AtomicApplicationPersistence["updateCurrentProfile"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    if (input.displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      throw new ApplicationError("INVALID_INPUT", "Display name must be 20 characters or fewer.");
    }
    if (
      input.idempotency.actorId !== input.actorId ||
      input.idempotency.commandType !== "update-profile-display-name" ||
      input.displayName.length === 0 ||
      input.displayName.trim() !== input.displayName
    ) {
      throw new ApplicationError("INVALID_INPUT", "The Display Name command is invalid.");
    }
    await this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { displayName: input.displayName } },
      () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
        const raw = await tables.getRow(TABLE.profiles, String(input.actorId));
        if (!raw) throw new ApplicationError("NOT_FOUND", "Profile not found.");
        const current = mapProfileDisplay(raw);
        if (current.displayName === input.displayName) return;
        if (current.version !== input.expectedVersion) {
          throw new ApplicationError("PROFILE_VERSION_CONFLICT", "This Profile changed while you were editing it.");
        }
        await tablesDB.updateRow({
          databaseId: "hft",
          tableId: TABLE.profiles,
          rowId: String(input.actorId),
          data: { displayName: input.displayName, version: current.version + 1, updatedAt: input.occurredAt },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.context.stageOutcome(tablesDB, tx, input.idempotency, String(input.actorId), input.occurredAt);
      }),
      () => undefined,
      input.idempotency,
    );
  }
}
