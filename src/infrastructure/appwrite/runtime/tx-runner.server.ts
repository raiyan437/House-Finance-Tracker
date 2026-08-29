import "server-only";

import type { TablesDB } from "node-appwrite";
import { transactionFailureFromProvider, TransactionFailure } from "./tx-errors.server";

/**
 * Command-transaction TTL. Verified provider range is 60–3600 seconds; the
 * runner keeps transactions short (60 s), and a unit of work that expires is
 * retried once with a fresh handle before surfacing as busy.
 */
export const COMMAND_TRANSACTION_TTL_SECONDS = 60;
const MAX_EXPIRED_RETRIES = 1;

export interface CommandTransaction {
  /** Provider-assigned opaque id; never derived from command ids. */
  readonly id: string;
  stagedOperations(): number;
  recordStagedOperation(): void;
}

interface WorkContext {
  readonly tx: CommandTransaction;
}

/**
 * Runs one unit of work inside a single provider transaction: creates the
 * handle, executes staging/revalidation work, then commits. Any failure rolls
 * the handle back best-effort before propagating. Expired handles retry once
 * with a fresh transaction; conflicts/limits propagate for translation.
 */
export async function runCommandTransaction<T>(tablesDB: TablesDB, work: (context: WorkContext) => Promise<T>): Promise<T> {
  let expiredRetries = 0;
  for (;;) {
    const created = await tablesDB.createTransaction({ ttl: COMMAND_TRANSACTION_TTL_SECONDS });
    const txId = String(created.$id);
    let staged = 0;
    const tx: CommandTransaction = {
      id: txId,
      stagedOperations: () => staged,
      recordStagedOperation: () => {
        staged += 1;
        if (staged > 100) throw new TransactionFailure("limit", "More than 100 operations were staged.");
      },
    };
    try {
      const result = await work({ tx });
      await tablesDB.updateTransaction({ transactionId: txId, commit: true });
      return result;
    } catch (error) {
      await tablesDB.updateTransaction({ transactionId: txId, rollback: true }).catch(() => undefined);
      await tablesDB.deleteTransaction({ transactionId: txId }).catch(() => undefined);
      const failure = error instanceof TransactionFailure
        ? error
        : transactionFailureFromProvider(error);
      if (failure?.kind === "expired" && expiredRetries < MAX_EXPIRED_RETRIES) {
        expiredRetries += 1;
        continue;
      }
      throw failure ?? error;
    }
  }
}
