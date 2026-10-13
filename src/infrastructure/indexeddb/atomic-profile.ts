import { ApplicationError } from "@/application/errors/application-error";
import { assertIdempotentIntent, commandOutcomeKey } from "@/application/idempotency/command-idempotency";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from "@/domain/records/domain-records";
import { persistenceFailure } from "./repositories";
import { fromCommandOutcomeRecord, fromProfileRecord, toCommandOutcomeRecord, toProfileRecord } from "./mappers";
import { IndexedDbCommandContext, abortSafely } from "./atomic-context";

/** profile commands retain their original complete transaction boundaries. */
export class IndexedDbProfileCommands implements Pick<AtomicApplicationPersistence, "updateCurrentProfile"> {
  constructor(private readonly context: IndexedDbCommandContext) {}

async updateCurrentProfile(input: Parameters<AtomicApplicationPersistence["updateCurrentProfile"]>[0]): Promise<void> {
    if (input.displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      throw new ApplicationError("INVALID_INPUT", "Display name must be 20 characters or fewer.");
    }
    if (input.idempotency.actorId !== input.actorId || input.idempotency.commandType !== "update-profile-display-name") {
      throw new ApplicationError("CONFLICT", "Profile command identity is inconsistent.");
    }
    const tx = (await this.context.db()).transaction(["userProfiles", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingOutcome = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingOutcome) {
        assertIdempotentIntent(fromCommandOutcomeRecord(existingOutcome, outcomeKey), input.idempotency);
        await tx.done;
        return;
      }
      const raw = await tx.objectStore("userProfiles").get(input.actorId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Profile not found.");
      const current = fromProfileRecord(raw, input.actorId);
      if (current.displayName === input.displayName) {
        await tx.done;
        return;
      }
      if (current.version !== input.expectedVersion) {
        throw new ApplicationError("PROFILE_VERSION_CONFLICT", "This Profile changed while you were editing it.");
      }
      const updated = { ...current, displayName: input.displayName, version: current.version + 1, updatedAt: input.occurredAt };
      await tx.objectStore("userProfiles").put(toProfileRecord(updated));
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({
        ...input.idempotency,
        resourceId: String(input.actorId),
        completedAt: input.occurredAt,
      }));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }
}
