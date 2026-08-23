import { AppwriteException, type Functions, type Storage, type TablesDB } from "node-appwrite";
import {
  BUCKET,
  DATABASE_ID,
  MAINTENANCE_FUNCTION,
  TABLES,
  type ColumnDefinition,
  type IndexDefinition,
  type TableDefinition,
} from "../schema/definitions";

export interface ExistingColumn {
  readonly key: string;
}

export interface ExistingIndex {
  readonly key: string;
}

export interface AppwriteSchemaReader {
  getDatabase(databaseId: string): Promise<{ id: string } | undefined>;
  listTables(databaseId: string): Promise<readonly { id: string }[]>;
  listColumns(databaseId: string, tableId: string): Promise<readonly ExistingColumn[]>;
  listIndexes(databaseId: string, tableId: string): Promise<readonly ExistingIndex[]>;
  getBucket(bucketId: string): Promise<{ id: string } | undefined>;
  getFunction(functionId: string): Promise<{ id: string } | undefined>;
}

export function appwriteSchemaReader(clients: Readonly<{ tablesDB: TablesDB; storage?: Storage; functions?: Functions }>): AppwriteSchemaReader {
  async function optional(call: () => Promise<{ $id: string }>): Promise<{ id: string } | undefined> {
    try {
      const result = await call();
      return { id: result.$id };
    } catch (error) {
      if (error instanceof AppwriteException && error.code === 404) return undefined;
      throw error;
    }
  }
  return {
    getDatabase: (databaseId) => optional(() => clients.tablesDB.get({ databaseId })),
    listTables: async (databaseId) => (await clients.tablesDB.listTables({ databaseId })).tables.map((table) => ({ id: table.$id })),
    listColumns: async (databaseId, tableId) =>
      (await clients.tablesDB.listColumns({ databaseId, tableId })).columns.map((column) => ({ key: column.key })),
    listIndexes: async (databaseId, tableId) =>
      (await clients.tablesDB.listIndexes({ databaseId, tableId })).indexes.map((index) => ({ key: index.key })),
    getBucket: (bucketId) => { const storage = clients.storage; return storage ? optional(() => storage.getBucket({ bucketId })) : Promise.resolve(undefined); },
    getFunction: (functionId) => { const functions = clients.functions; return functions ? optional(() => functions.get({ functionId })) : Promise.resolve(undefined); },
  };
}

export interface PlannedTable {
  readonly table: TableDefinition;
  readonly columns: readonly ColumnDefinition[];
  readonly indexes: readonly IndexDefinition[];
}

export interface SchemaPlan {
  readonly databaseExists: boolean;
  readonly createDatabase: boolean;
  readonly tables: readonly PlannedTable[];
  readonly existingCompleteTables: readonly string[];
  readonly bucketExists: boolean;
  readonly createBucket: boolean;
  readonly functionExists: boolean;
  readonly createFunction: boolean;
  readonly drifts: readonly string[];
}

export async function planSchemaApplication(reader: AppwriteSchemaReader): Promise<SchemaPlan> {
  const drifts: string[] = [];
  const database = await reader.getDatabase(DATABASE_ID);
  if (database && database.id !== DATABASE_ID) drifts.push(`Database identifier mismatch: ${database.id}.`);
  const existingTables = new Set((await reader.listTables(DATABASE_ID)).map((table) => table.id));
  const plannedTables: PlannedTable[] = [];
  const complete: string[] = [];
  for (const definition of TABLES) {
    if (!existingTables.has(definition.id)) {
      plannedTables.push({ columns: definition.columns, indexes: definition.indexes, table: definition });
      continue;
    }
    const [existingColumns, existingIndexes] = await Promise.all([
      reader.listColumns(DATABASE_ID, definition.id),
      reader.listIndexes(DATABASE_ID, definition.id),
    ]);
    const missingColumns = definition.columns.filter((column) => !existingColumns.some((existing) => existing.key === column.key));
    const missingIndexes = definition.indexes.filter((index) => !existingIndexes.some((existing) => existing.key === index.key));
    const unexpectedColumns = existingColumns.filter(
      (existing) => existing.key !== "$id" && !definition.columns.some((column) => column.key === existing.key),
    );
    if (missingColumns.length > 0 || missingIndexes.length > 0) {
      plannedTables.push({ columns: missingColumns, indexes: missingIndexes, table: definition });
    }
    if (unexpectedColumns.length > 0) {
      drifts.push(`Table ${definition.id} has unmanaged columns: ${unexpectedColumns.map((column) => column.key).join(", ")}.`);
    }
    if (missingColumns.length === 0 && missingIndexes.length === 0 && unexpectedColumns.length === 0) complete.push(definition.id);
  }
  const [bucket, maintenance] = await Promise.all([reader.getBucket(BUCKET.id), reader.getFunction(MAINTENANCE_FUNCTION.id)]);
  return {
    createBucket: !bucket,
    createDatabase: !database,
    createFunction: !maintenance,
    databaseExists: Boolean(database),
    drifts,
    existingCompleteTables: complete,
    functionExists: Boolean(maintenance),
    bucketExists: Boolean(bucket),
    tables: plannedTables,
  };
}
