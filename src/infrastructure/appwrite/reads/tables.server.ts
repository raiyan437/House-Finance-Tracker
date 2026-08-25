import "server-only";
import { Query, type TablesDB } from "node-appwrite";
import type { Models } from "node-appwrite";
import { ApplicationError } from "@/application/errors/application-error";
import { DATABASE_ID } from "../schema/definitions";
import { isProviderNotFound, normalizedProviderFailure } from "./provider-errors.server";

/** Hard safety cap: the frozen envelope (~4 users, ~180 expenses/year) can never approach this. */
const MAX_ROWS_PER_TABLE = 5_000;
const PAGE_SIZE = 100;

export type AppwriteRow = Models.Row & Record<string, unknown>;

export interface TablesReader {
  getRow(tableId: string, rowId: string): Promise<AppwriteRow | undefined>;
  listRows(tableId: string, queries?: readonly string[]): Promise<readonly AppwriteRow[]>;
}

class ProviderTablesReader implements TablesReader {
  constructor(private readonly tablesDB: TablesDB) {}

  async getRow(tableId: string, rowId: string): Promise<AppwriteRow | undefined> {
    try {
      return (await this.tablesDB.getRow({ databaseId: DATABASE_ID, tableId, rowId })) as AppwriteRow;
    } catch (error) {
      if (isProviderNotFound(error)) return undefined;
      throw normalizedProviderFailure(error);
    }
  }

  async listRows(tableId: string, queries: readonly string[] = []): Promise<readonly AppwriteRow[]> {
    const rows: AppwriteRow[] = [];
    let cursor: string | undefined;
    try {
      do {
        const pageQueries = [...queries, Query.limit(PAGE_SIZE)];
        const page = await this.tablesDB.listRows({
          databaseId: DATABASE_ID,
          tableId,
          queries: cursor ? [...pageQueries, Query.cursorAfter(cursor)] : pageQueries,
        });
        rows.push(...(page.rows as AppwriteRow[]));
        cursor = page.rows.length === PAGE_SIZE ? page.rows[page.rows.length - 1]?.$id : undefined;
      } while (cursor && rows.length < MAX_ROWS_PER_TABLE);
    } catch (error) {
      throw normalizedProviderFailure(error);
    }
    if (rows.length > MAX_ROWS_PER_TABLE) {
      throw new ApplicationError("PERSISTENCE_FAILURE", "The production data plane returned an unexpected data volume.");
    }
    return rows;
  }
}

export function createTablesReader(tablesDB: TablesDB): TablesReader {
  return new ProviderTablesReader(tablesDB);
}
