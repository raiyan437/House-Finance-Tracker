import type { AppwriteRow } from "./tables.server";
import type { TablesReader } from "./tables.server";

interface ParsedQuery {
  readonly method: string;
  readonly attribute?: string;
  readonly values?: ReadonlyArray<unknown>;
}

/**
 * In-memory TablesDB stand-in shared by read-repository and provider-parity
 * tests. Understands the exact subset of Appwrite query primitives that the
 * R1 read repositories emit: equal, isNull, limit, cursorAfter.
 */
export class InMemoryTablesReader implements TablesReader {
  readonly tables = new Map<string, AppwriteRow[]>();

  table(tableId: string): AppwriteRow[] {
    let rows = this.tables.get(tableId);
    if (!rows) {
      rows = [];
      this.tables.set(tableId, rows);
    }
    return rows;
  }

  seed(tableId: string, rows: ReadonlyArray<Record<string, unknown>>): void {
    this.tables.set(tableId, rows.map((row) => row as AppwriteRow));
  }

  async getRow(tableId: string, rowId: string): Promise<AppwriteRow | undefined> {
    return this.table(tableId).find((row) => row.$id === rowId);
  }

  async listRows(tableId: string, queries: readonly string[] = []): Promise<readonly AppwriteRow[]> {
    const parsed = queries.map((query) => JSON.parse(query) as ParsedQuery);
    let rows = [...this.table(tableId)];
    let cursorAfter: string | undefined;
    let limit = Number.POSITIVE_INFINITY;
    for (const query of parsed) {
      if (query.method === "equal" && query.attribute && query.values) {
        const allowed = query.values.map((value) => String(value));
        rows = rows.filter((row) => allowed.includes(String(row[query.attribute as string])));
      } else if (query.method === "isNull" && query.attribute) {
        const attribute = query.attribute;
        rows = rows.filter((row) => row[attribute] === null || row[attribute] === undefined);
      } else if (query.method === "cursorAfter" && query.values?.length) {
        cursorAfter = String(query.values[0]);
      } else if (query.method === "limit" && query.values?.length) {
        limit = Number(query.values[0]);
      }
    }
    if (cursorAfter !== undefined) {
      const index = rows.findIndex((row) => row.$id === cursorAfter);
      if (index >= 0) rows = rows.slice(index + 1);
    }
    return rows.slice(0, limit);
  }
}
