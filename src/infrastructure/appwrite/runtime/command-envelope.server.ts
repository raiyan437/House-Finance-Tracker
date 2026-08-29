import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped command envelope (R2 delivery correctness).
 *
 * Production command routes publish {commandType, commandId, intentSeed} so
 * the atomic persistence layer can ledger EVERY external mutation (not only
 * protected creates): lost-response retries replay the original sanitized
 * outcome and changed-intent reuse fails closed. The local composition never
 * opens an envelope, so the frozen IndexedDB MVP performs no outcome writes.
 */
export interface CommandEnvelope {
  readonly commandType: string;
  readonly commandId: string;
  /** Deterministic, validated intent inputs; hashed with SHA-256 in the adapter. */
  readonly intentSeed: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<CommandEnvelope>();

export function runWithCommandEnvelope<T>(envelope: CommandEnvelope, work: () => Promise<T>): Promise<T> {
  return storage.run(envelope, work);
}

export function currentCommandEnvelope(): CommandEnvelope | undefined {
  return storage.getStore();
}
