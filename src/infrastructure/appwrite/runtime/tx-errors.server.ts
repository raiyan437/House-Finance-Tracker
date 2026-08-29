import "server-only";

/**
 * Normalized provider-transaction failure kinds (Gate A verified behavior):
 * - conflict: 409 transaction_conflict (concurrent underlying-row change OR
 *   commit-time unique-index violation). Callers re-read authoritative state
 *   (e.g., command outcomes) before translating to a typed application error.
 * - expired: 410 transaction_expired after the 60–3600 s TTL. The handle is
 *   dead; a fresh transaction may retry the whole unit of work.
 * - limit: 400 transaction_limit_exceeded at staging — an internal invariant
 *   failure; never partially continued outside the transaction.
 */
export type TransactionFailureKind = "conflict" | "expired" | "limit";

export class TransactionFailure extends Error {
  readonly kind: TransactionFailureKind;

  constructor(kind: TransactionFailureKind, message: string) {
    super(message);
    this.name = "TransactionFailure";
    this.kind = kind;
  }
}

export function transactionFailureFromProvider(error: unknown): TransactionFailure | undefined {
  const candidate = error as { code?: unknown; type?: unknown };
  if (typeof candidate?.code !== "number") return undefined;
  const type = String(candidate.type ?? "");
  if (candidate.code === 409 || type === "transaction_conflict") {
    return new TransactionFailure("conflict", "The household state changed concurrently.");
  }
  if (candidate.code === 410 || type === "transaction_expired") {
    return new TransactionFailure("expired", "The transaction expired before it was committed.");
  }
  if (type === "transaction_limit_exceeded") {
    return new TransactionFailure("limit", "The transaction exceeded the provider operation limit.");
  }
  return undefined;
}
