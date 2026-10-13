import { ApplicationError } from "@/application/errors/application-error";
import { assertIdempotentIntent, commandOutcomeKey } from "@/application/idempotency/command-idempotency";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { persistenceFailure } from "./repositories";
import { fromCardRecord, fromCommandOutcomeRecord, toCardRecord, toCommandOutcomeRecord } from "./mappers";
import { IndexedDbCommandContext, abortSafely } from "./atomic-context";

/** card commands retain their original complete transaction boundaries. */
export class IndexedDbCardCommands implements Pick<AtomicApplicationPersistence, "createCard" | "updateCard" | "removeCard"> {
  constructor(private readonly context: IndexedDbCommandContext) {}

async createCard(input: Parameters<AtomicApplicationPersistence["createCard"]>[0]): Promise<string> {
    if (input.card.archivedAt) throw new ApplicationError("CONFLICT", "A new card cannot be archived.");
    if (input.idempotency.actorId !== input.card.ownerId || input.idempotency.commandType !== "create-card") throw new ApplicationError("CONFLICT", "Card command identity is inconsistent.");
    const tx = (await this.context.db()).transaction(["cards", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) { const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey); assertIdempotentIntent(existing, input.idempotency); await tx.done; return existing.resourceId; }
      await tx.objectStore("cards").add(toCardRecord(input.card));
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.card.cardId, completedAt: input.card.createdAt }));
      await tx.done;
      return input.card.cardId;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async updateCard(input: Parameters<AtomicApplicationPersistence["updateCard"]>[0]): Promise<void> {
    if (input.card.archivedAt) throw new ApplicationError("CONFLICT", "Archived cards cannot be edited.");
    const tx = (await this.context.db()).transaction("cards", "readwrite");
    try {
      const raw = await tx.store.get(input.card.cardId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Card not found.");
      const current = fromCardRecord(raw, input.card.cardId);
      if (current.ownerId !== input.card.ownerId) throw new ApplicationError("NOT_FOUND", "Card not found.");
      if (current.archivedAt) throw new ApplicationError("NOT_FOUND", "Card not found.");
      if (current.updatedAt !== input.expectedUpdatedAt) throw new ApplicationError("CONFLICT", "Card changed before this edit could be saved.");
      if (current.createdAt !== input.card.createdAt) throw new ApplicationError("CONFLICT", "Card identity metadata cannot be changed.");
      await tx.store.put(toCardRecord(input.card));
      await tx.done;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async removeCard(input: Parameters<AtomicApplicationPersistence["removeCard"]>[0]) {
    const tx = (await this.context.db()).transaction(["cards", "expenseCardPrivateDetails"], "readwrite");
    try {
      const raw = await tx.objectStore("cards").get(input.cardId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Card not found.");
      const current = fromCardRecord(raw, input.cardId);
      if (current.ownerId !== input.ownerId || current.archivedAt) {
        throw new ApplicationError("NOT_FOUND", "Card not found.");
      }
      const referenced = Boolean(
        await tx.objectStore("expenseCardPrivateDetails").index("cardId").getKey(input.cardId),
      );
      const actualAction = referenced ? "archive" as const : "delete" as const;
      if (actualAction !== input.expectedAction) {
        throw new ApplicationError(
          "CONFLICT",
          "Card usage changed. Refresh and confirm the updated action.",
        );
      }
      if (actualAction === "archive") {
        await tx.objectStore("cards").put(toCardRecord({
          ...current,
          updatedAt: input.occurredAt,
          archivedAt: input.occurredAt,
        }));
      } else {
        await tx.objectStore("cards").delete(input.cardId);
      }
      await tx.done;
      return actualAction === "archive" ? "archived" as const : "deleted" as const;
    } catch (error) {
      abortSafely(tx);
      persistenceFailure(error);
    }
  }
}
