import "server-only";
import type { TablesDB } from "node-appwrite";
import { assertGuardIdentity, guardRowId } from "../ids";
import type { CommandTransaction } from "./tx-runner.server";
import { TransactionFailure } from "./tx-errors.server";

export const GUARD_TABLE = "coordination_guards";

export type GuardKind =
  | "active-membership"
  | "active-leader"
  | "pending-join"
  | "financial";

function logicalKey(kind: GuardKind, subject: string): string {
  return `${kind}:${subject}`;
}

/**
 * Coordination-guard engine over the shared `coordination_guards` table.
 * Row IDs derive from the full logical key (prefix + truncated SHA-256) and
 * every release/transfer verifies BOTH the derived id and the stored key so
 * collisions or drift fail closed. All mutations are staged inside the caller's
 * command transaction; uniqueness is index-enforced at commit (409
 * transaction_conflict) with in-transaction pre-checks for precise errors.
 */
export class CommandGuardEngine {
  constructor(
    private readonly tablesDB: TablesDB,
    private readonly tx: CommandTransaction,
    private readonly nowIso: string,
  ) {}

  private rowIdFor(kind: GuardKind, subject: string): string {
    return guardRowId(logicalKey(kind, subject));
  }

  private async readGuard(kind: GuardKind, subject: string): Promise<Record<string, unknown> | undefined> {
    const rowId = this.rowIdFor(kind, subject);
    const row = await this.tablesDB.getRow({ databaseId: "hft", tableId: GUARD_TABLE, rowId, transactionId: this.tx.id }).catch(() => undefined);
    if (!row) return undefined;
    // Fail closed on identity drift between derivation and storage.
    assertGuardIdentity({ id: String(row.$id), logicalKey: String(row.logicalKey) }, logicalKey(kind, subject));
    return row as Record<string, unknown>;
  }

  /** Acquires a fresh guard; a pre-existing guard is a typed conflict. */
  async acquire(kind: GuardKind, subject: string, ownerValue?: string): Promise<void> {
    if (await this.readGuard(kind, subject)) {
      throw new TransactionFailure("conflict", `Coordination guard '${logicalKey(kind, subject)}' already exists.`);
    }
    const rowId = this.rowIdFor(kind, subject);
    await this.tablesDB.createRow({
      databaseId: "hft",
      tableId: GUARD_TABLE,
      rowId,
      data: { logicalKey: logicalKey(kind, subject), ownerValue: ownerValue ?? null, counter: 0, version: 0, createdAt: this.nowIso },
      transactionId: this.tx.id,
    });
    this.tx.recordStagedOperation();
  }

  /** Releases an existing guard after verifying its stored identity/owner. */
  async release(kind: GuardKind, subject: string, expectedOwner?: string): Promise<void> {
    const rowId = this.rowIdFor(kind, subject);
    const row = await this.readGuard(kind, subject);
    if (!row) return; // already absent — releasing is idempotent within the tx
    if (expectedOwner !== undefined && row.ownerValue != null && String(row.ownerValue) !== expectedOwner) {
      throw new TransactionFailure("conflict", `Coordination guard '${logicalKey(kind, subject)}' belongs to another owner.`);
    }
    await this.tablesDB.deleteRow({ databaseId: "hft", tableId: GUARD_TABLE, rowId, transactionId: this.tx.id });
    this.tx.recordStagedOperation();
  }

  /** Atomically moves the single leader guard to a new owner (update, not delete+create). */
  async transferOwnership(kind: GuardKind, subject: string, fromOwner: string, toOwner: string): Promise<void> {
    const row = await this.readGuard(kind, subject);
    if (!row || row.ownerValue == null || String(row.ownerValue) !== fromOwner) {
      throw new TransactionFailure("conflict", `Coordination guard '${logicalKey(kind, subject)}' does not belong to the current leader.`);
    }
    const rowId = this.rowIdFor(kind, subject);
    await this.tablesDB.updateRow({ databaseId: "hft", tableId: GUARD_TABLE, rowId, data: { ownerValue: toOwner }, transactionId: this.tx.id });
    this.tx.recordStagedOperation();
  }
}
