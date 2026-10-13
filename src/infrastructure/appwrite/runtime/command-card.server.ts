import "server-only";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { ApplicationError } from "@/application/errors/application-error";
import type { CardRemovalResult } from "@/domain/cards/card-lifecycle";
import { mapCard } from "../reads/mappers.server";
import { runCommandTransaction } from "./tx-runner.server";
import { CommandGuardEngine } from "./guards.server";
import { AppwriteCommandContext, TABLE } from "./command-context.server";

/** card commands retain their original complete transaction boundaries. */
export class AppwriteCardCommands implements Pick<AtomicApplicationPersistence, "createCard" | "updateCard" | "removeCard"> {
  constructor(private readonly context: AppwriteCommandContext) {}

// -- R3B: owner-private Cards ---------------------------------------------

  async createCard(input: Parameters<AtomicApplicationPersistence["createCard"]>[0]): Promise<string> {
    const tablesDB = this.context.tablesDB;
    const { card, idempotency } = input;
    return this.context.resolveDelivery(
      tablesDB,
      {
        actorId: String(card.ownerId),
        intentSeed: { name: card.name, type: card.type, colorId: card.colorId },
      },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
        if (await tables.getRow(TABLE.cards, String(card.cardId))) {
          throw new ApplicationError("CONFLICT", "Card already exists.");
        }
        const guards = new CommandGuardEngine(tablesDB, tx, card.createdAt);
        await guards.acquire("card", String(card.cardId), String(card.ownerId));
        await tablesDB.createRow({
          databaseId: "hft",
          tableId: TABLE.cards,
          rowId: String(card.cardId),
          data: {
            ownerId: String(card.ownerId),
            name: card.name,
            design: card.colorId,
            type: card.type,
            status: "active",
            archivedAt: null,
            version: 1,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
          },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.context.stageOutcome(tablesDB, tx, idempotency, String(card.cardId), card.createdAt);
        this.context.lastR3StagedOperations.createCard = tx.stagedOperations();
        return String(card.cardId);
      }),
      (resourceId) => resourceId,
      idempotency,
    );
  }

async updateCard(input: Parameters<AtomicApplicationPersistence["updateCard"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    const { card } = input;
    const intentSeed = { cardId: String(card.cardId), name: card.name, type: card.type, colorId: card.colorId };
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(card.ownerId), intentSeed },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
        const raw = await tables.getRow(TABLE.cards, String(card.cardId));
        const current = raw ? mapCard(raw) : undefined;
        if (!current || current.ownerId !== card.ownerId || current.archivedAt) {
          throw new ApplicationError("NOT_FOUND", "Card not found.");
        }
        if (current.updatedAt !== input.expectedUpdatedAt) {
          throw new ApplicationError("CONFLICT", "This Card changed while you were editing it.");
        }
        const version = Number(raw?.version);
        if (!Number.isSafeInteger(version) || version < 1) {
          throw new ApplicationError("PERSISTENCE_FAILURE", "Stored Card version is invalid.");
        }
        const guards = new CommandGuardEngine(tablesDB, tx, card.updatedAt);
        await guards.touch("card", String(card.cardId), String(card.ownerId));
        await tablesDB.updateRow({
          databaseId: "hft",
          tableId: TABLE.cards,
          rowId: String(card.cardId),
          data: { name: card.name, design: card.colorId, type: card.type, updatedAt: card.updatedAt, version: version + 1 },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(card.ownerId), intentSeed, String(card.cardId), card.updatedAt);
        this.context.lastR3StagedOperations.editCard = tx.stagedOperations();
      }),
      () => undefined,
    );
  }

async removeCard(input: Parameters<AtomicApplicationPersistence["removeCard"]>[0]): Promise<CardRemovalResult> {
    const tablesDB = this.context.tablesDB;
    const intentSeed = { cardId: String(input.cardId), expectedAction: input.expectedAction };
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.ownerId), intentSeed },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
        const raw = await tables.getRow(TABLE.cards, String(input.cardId));
        const current = raw ? mapCard(raw) : undefined;
        if (!current || current.ownerId !== input.ownerId || current.archivedAt) {
          throw new ApplicationError("NOT_FOUND", "Card not found.");
        }
        const referenced = (await tables.listRows(TABLE.expenseCardPrivateDetails, []))
          .some((row) => String(row.ownerId) === String(input.ownerId) && String(row.cardId) === String(input.cardId));
        const actualAction = referenced ? "archive" : "delete";
        if (actualAction !== input.expectedAction) {
          throw new ApplicationError("CONFLICT", "Card usage changed. Refresh the removal preview and confirm again.");
        }
        const guards = new CommandGuardEngine(tablesDB, tx, input.occurredAt);
        if (actualAction === "delete") {
          await guards.release("card", String(input.cardId), String(input.ownerId));
          await tablesDB.deleteRow({
            databaseId: "hft",
            tableId: TABLE.cards,
            rowId: String(input.cardId),
            transactionId: tx.id,
          });
          tx.recordStagedOperation();
        } else {
          const version = Number(raw?.version);
          if (!Number.isSafeInteger(version) || version < 1) {
            throw new ApplicationError("PERSISTENCE_FAILURE", "Stored Card version is invalid.");
          }
          await guards.touch("card", String(input.cardId), String(input.ownerId));
          await tablesDB.updateRow({
            databaseId: "hft",
            tableId: TABLE.cards,
            rowId: String(input.cardId),
            data: { status: "archived", archivedAt: input.occurredAt, updatedAt: input.occurredAt, version: version + 1 },
            transactionId: tx.id,
          });
          tx.recordStagedOperation();
        }
        const outcomeResource = `${actualAction}:${String(input.cardId)}`;
        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(input.ownerId), intentSeed, outcomeResource, input.occurredAt);
        this.context.lastR3StagedOperations.removeCard = tx.stagedOperations();
        return actualAction === "delete" ? "deleted" : "archived";
      }),
      (resourceId) => {
        const action = resourceId.split(":", 1)[0];
        if (action !== "delete" && action !== "archive") {
          throw new ApplicationError("PERSISTENCE_FAILURE", "Stored Card command outcome is invalid.");
        }
        return action === "delete" ? "deleted" : "archived";
      },
    );
  }
}
