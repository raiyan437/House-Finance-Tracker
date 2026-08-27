import { randomUUID } from "node:crypto";
import type { AppwriteRow } from "./tables.server";
import type { TablesReader } from "./tables.server";
import { TransactionFailure } from "../runtime/tx-errors.server";

interface ParsedQuery {
  readonly method: string;
  readonly attribute?: string;
  readonly values?: ReadonlyArray<unknown>;
}

/** Unique constraints mirrored from the applied schema (commit-time enforcement). */
const UNIQUE_CONSTRAINTS: ReadonlyArray<{ table: string; attributes: readonly string[] }> = [
  { table: "coordination_guards", attributes: ["logicalKey"] },
  { table: "households", attributes: ["code"] },
  { table: "command_outcomes", attributes: ["actorId", "commandType", "commandId"] },
];

const DELETED = Symbol("deleted");

function parseQueries(queries: readonly string[]): ParsedQuery[] {
  return queries.map((query) => JSON.parse(query) as ParsedQuery);
}

function matchesFilters(row: AppwriteRow, parsed: readonly ParsedQuery[]): boolean {
  for (const query of parsed) {
    if (query.method === "equal" && query.attribute && query.values) {
      const allowed = query.values.map((value) => String(value));
      if (!allowed.includes(String(row[query.attribute]))) return false;
    } else if (query.method === "isNull" && query.attribute) {
      const value = row[query.attribute];
      if (!(value === null || value === undefined)) return false;
    }
  }
  return true;
}

/**
 * In-memory TablesDB stand-in shared by read-repository, command-kernel,
 * and provider-parity tests. Implements the exact R2 subset: equal/isNull/
 * limit/cursorAfter queries, provider-assigned transaction handles with
 * staged-write visibility, commit-time unique-index enforcement, forced
 * conflict simulation, rollback isolation, and staged-operation counting.
 */
export class InMemoryTablesReader implements TablesReader {
  readonly tables = new Map<string, AppwriteRow[]>();
  private readonly overlays = new Map<string, Map<string, Map<string, AppwriteRow | typeof DELETED>>>();
  private readonly stagedCounts = new Map<string, number>();
  /** Row ids that force a commit-time conflict when touched by the named tx. */
  conflictOnCommit = new Set<string>();

  table(tableId: string): AppwriteRow[] {
    let rows = this.tables.get(tableId);
    if (!rows) {
      rows = [];
      this.tables.set(tableId, rows);
    }
    return rows;
  }

  seed(tableId: string, rows: ReadonlyArray<Record<string, unknown>>): void {
    this.tables.set(tableId, rows.map((row) => ({ ...row }) as AppwriteRow));
  }

  private overlay(txId?: string): Map<string, Map<string, AppwriteRow | typeof DELETED>> | undefined {
    if (!txId) return undefined;
    return this.overlays.get(txId);
  }

  private overlayTable(txId: string | undefined, tableId: string): Map<string, AppwriteRow | typeof DELETED> | undefined {
    return this.overlay(txId)?.get(tableId);
  }

  async getRow(tableId: string, rowId: string, transactionId?: string): Promise<AppwriteRow | undefined> {
    const perTable = this.overlayTable(transactionId, tableId);
    if (perTable) {
      const staged = perTable.get(rowId);
      if (staged === DELETED) return undefined;
      if (staged) return staged;
    }
    return this.table(tableId).find((row) => row.$id === rowId);
  }

  async listRows(tableId: string, queries: readonly string[] = [], transactionId?: string): Promise<readonly AppwriteRow[]> {
    const parsed = parseQueries(queries);
    let limit = Number.POSITIVE_INFINITY;
    let cursorAfter: string | undefined;
    for (const query of parsed) {
      if (query.method === "limit" && query.values?.length) limit = Number(query.values[0]);
      if (query.method === "cursorAfter" && query.values?.length) cursorAfter = String(query.values[0]);
    }
    const baseRows = this.table(tableId).filter((row) => matchesFilters(row, parsed));
    const over = this.overlay(transactionId);
    const stagedTable = over?.get(tableId);
    const stagedRows: AppwriteRow[] = [];
    if (stagedTable) {
      for (const [, row] of stagedTable) {
        if (row !== DELETED && !baseRows.some((base) => base.$id === row.$id) && matchesFilters(row, parsed)) {
          stagedRows.push(row);
        }
      }
    }
    let merged = [...baseRows, ...stagedRows];
    if (over && stagedTable) {
      merged = merged
        .map((row) => (stagedTable.has(row.$id) ? (stagedTable.get(row.$id) as AppwriteRow | typeof DELETED) : row))
        .filter((row): row is AppwriteRow => row !== DELETED)
        .filter((row) => matchesFilters(row, parsed));
    }
    if (cursorAfter !== undefined) {
      const index = merged.findIndex((row) => row.$id === cursorAfter);
      if (index >= 0) merged = merged.slice(index + 1);
    }
    return merged.slice(0, limit);
  }

  // -- transactional staging surface (used by the TablesDB stub) -----------

  createTransaction(): { $id: string; status: string } {
    const id = `tx-${randomUUID()}`;
    this.overlays.set(id, new Map());
    this.stagedCounts.set(id, 0);
    return { $id: id, status: "pending" };
  }

  stagedOperationCount(txId: string): number {
    return this.stagedCounts.get(txId) ?? 0;
  }

  private stage(txId: string, tableId: string, rowId: string, rowOrDeleted: AppwriteRow | typeof DELETED): void {
    const over = this.overlays.get(txId);
    if (!over) throw new Error("Unknown transaction handle.");
    let perTable = over.get(tableId);
    if (!perTable) {
      perTable = new Map();
      over.set(tableId, perTable);
    }
    perTable.set(rowId, rowOrDeleted);
    this.stagedCounts.set(txId, (this.stagedCounts.get(txId) ?? 0) + 1);
    if ((this.stagedCounts.get(txId) ?? 0) > 100) throw new TransactionFailure("limit", "More than 100 operations were staged.");
  }

  stageCreateRow(_databaseId: string, tableId: string, rowId: string, data: Record<string, unknown>, txId?: string): void {
    const row = { $id: rowId, ...(data as Record<string, unknown>) } as AppwriteRow;
    if (txId) {
      this.stage(txId, tableId, rowId, row);
      return;
    }
    this.assertUniqueOnSet(tableId, [row]);
    this.table(tableId).push(row);
  }

  stageUpdateRow(_databaseId: string, tableId: string, rowId: string, data: Record<string, unknown>, txId?: string): void {
    if (txId) {
      const current =
        this.overlay(txId)?.get(tableId)?.get(rowId) ??
        this.table(tableId).find((row) => row.$id === rowId);
      if (!current || current === DELETED) throw new Error(`Update target missing: ${tableId}/${rowId}`);
      this.stage(txId, tableId, rowId, { ...current, ...(data as Record<string, unknown>) });
      return;
    }
    const row = this.table(tableId).find((entry) => entry.$id === rowId);
    if (!row) throw new Error(`Update target missing: ${tableId}/${rowId}`);
    Object.assign(row, data);
  }

  stageDeleteRow(_databaseId: string, tableId: string, rowId: string, txId?: string): void {
    if (txId) {
      this.stage(txId, tableId, rowId, DELETED);
      return;
    }
    const rows = this.table(tableId);
    const index = rows.findIndex((row) => row.$id === rowId);
    if (index >= 0) rows.splice(index, 1);
  }

  private assertUniqueOnSet(tableId: string, incoming: readonly AppwriteRow[]): void {
    for (const constraint of UNIQUE_CONSTRAINTS.filter((entry) => entry.table === tableId)) {
      const keyOf = (row: AppwriteRow) => JSON.stringify(constraint.attributes.map((attribute) => String(row[attribute])));
      const existingBase = new Set(this.table(tableId).map(keyOf));
      const seen = new Set<string>();
      for (const row of incoming) {
        const key = keyOf(row);
        if (existingBase.has(key) || seen.has(key)) {
          throw new TransactionFailure("conflict", `Unique constraint violated on ${tableId}.`);
        }
        seen.add(key);
      }
    }
  }

  /** Commits an overlay; enforces unique constraints against committed state. */
  commitTransaction(txId: string): void {
    const over = this.overlays.get(txId);
    if (!over) throw new TransactionFailure("conflict", "Unknown transaction handle.");
    const touchedConflictRow = [...over.entries()].some(([tableId, perTable]) =>
      [...perTable.keys()].some((rowId) => this.conflictOnCommit.has(`${tableId}/${rowId}`)),
    );
    if (touchedConflictRow) throw new TransactionFailure("conflict", "The transaction has a conflict.");
    for (const [tableId, perTable] of over.entries()) {
      const survivingCreates: AppwriteRow[] = [];
      for (const [rowId, row] of perTable.entries()) {
        if (row === DELETED) {
          const rows = this.table(tableId);
          const index = rows.findIndex((entry) => entry.$id === rowId);
          if (index >= 0) rows.splice(index, 1);
        } else {
          const rows = this.table(tableId);
          const index = rows.findIndex((entry) => entry.$id === rowId);
          if (index >= 0) rows[index] = row;
          else survivingCreates.push(row);
        }
      }
      this.assertUniqueOnSet(tableId, survivingCreates);
      const rows = this.table(tableId);
      for (const row of survivingCreates) rows.push(row);
    }
    this.overlays.delete(txId);
    this.stagedCounts.delete(txId);
  }

  rollbackTransaction(txId: string): void {
    this.overlays.delete(txId);
    this.stagedCounts.delete(txId);
  }
}

/**
 * A minimal TablesDB double backed by an InMemoryTablesReader, exposing the
 * exact call shapes the command kernel uses (provider-assigned transaction ids,
 * transaction-scoped reads/writes, commit/rollback).
 */
export function createInMemoryTablesDB(reader: InMemoryTablesReader) {
  const openTransactions = new Set<string>();
  return {
    reader,
    tablesDB: {
      async createTransaction(): Promise<{ $id: string; status: string }> {
        const created = reader.createTransaction();
        openTransactions.add(created.$id);
        return created;
      },
      async updateTransaction(input: { transactionId: string; commit?: boolean; rollback?: boolean }): Promise<{ status: string }> {
        if (!openTransactions.has(input.transactionId)) throw new TransactionFailure("expired", "The transaction expired before it was committed.");
        if (input.rollback) {
          reader.rollbackTransaction(input.transactionId);
          openTransactions.delete(input.transactionId);
          return { status: "rolled_back" };
        }
        try {
          reader.commitTransaction(input.transactionId);
        } catch (error) {
          openTransactions.delete(input.transactionId);
          throw error;
        }
        openTransactions.delete(input.transactionId);
        return { status: "committed" };
      },
      async deleteTransaction(input: { transactionId: string }): Promise<void> {
        openTransactions.delete(input.transactionId);
        reader.rollbackTransaction(input.transactionId);
      },
      async getRow(input: { databaseId: string; tableId: string; rowId: string; transactionId?: string }) {
        return reader.getRow(input.tableId, input.rowId, input.transactionId);
      },
      async listRows(input: { databaseId: string; tableId: string; queries?: string[]; transactionId?: string }) {
        const rows = await reader.listRows(input.tableId, input.queries ?? [], input.transactionId);
        return { rows, total: rows.length };
      },
      async createRow(input: { databaseId: string; tableId: string; rowId: string; data: Record<string, unknown>; transactionId?: string }) {
        reader.stageCreateRow(input.databaseId, input.tableId, input.rowId, input.data, input.transactionId);
        return { $id: input.rowId };
      },
      async updateRow(input: { databaseId: string; tableId: string; rowId: string; data: Record<string, unknown>; transactionId?: string }) {
        reader.stageUpdateRow(input.databaseId, input.tableId, input.rowId, input.data, input.transactionId);
        return { $id: input.rowId };
      },
      async deleteRow(input: { databaseId: string; tableId: string; rowId: string; transactionId?: string }) {
        reader.stageDeleteRow(input.databaseId, input.tableId, input.rowId, input.transactionId);
        return {};
      },
    },
  };
}
