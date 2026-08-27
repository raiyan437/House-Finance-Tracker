import { AppwriteException, type Functions, type Storage, type TablesDB } from "node-appwrite";
import {
  BUCKET,
  DATABASE_ID,
  MAINTENANCE_FUNCTION,
  SAFE_STRING_CAPACITY_INCREASES,
  SCHEMA_METADATA_ROW_ID,
  SCHEMA_VERSION,
  TABLES,
  type ColumnDefinition,
  type IndexDefinition,
  type TableDefinition,
} from "../schema/definitions";

export interface ExistingColumn {
  readonly key: string;
  readonly status?: string;
  readonly kind?: string;
  readonly format?: string;
  readonly elements?: readonly string[];
  readonly size?: number;
  readonly required?: boolean;
}

export interface ExistingIndex {
  readonly key: string;
  readonly status?: string;
}

export interface AppwriteSchemaReader {
  getDatabase(databaseId: string): Promise<{ id: string } | undefined>;
  listTables(databaseId: string): Promise<readonly { id: string }[]>;
  listColumns(databaseId: string, tableId: string): Promise<readonly ExistingColumn[]>;
  listIndexes(databaseId: string, tableId: string): Promise<readonly ExistingIndex[]>;
  getBucket(bucketId: string): Promise<{ id: string } | undefined>;
  getFunction(functionId: string): Promise<{ id: string } | undefined>;
  getSchemaVersionRow(): Promise<{ version: number } | undefined>;
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
  async function listOrEmpty<T>(call: () => Promise<T>, empty: T): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AppwriteException && error.code === 404) return empty;
      throw error;
    }
  }
  return {
    getDatabase: (databaseId) => optional(() => clients.tablesDB.get({ databaseId })),
    listTables: async (databaseId) =>
      ((await listOrEmpty(() => clients.tablesDB.listTables({ databaseId }), { tables: [], total: 0 })) as { tables: { $id: string }[] }).tables.map(
        (table) => ({ id: table.$id }),
      ),
    listColumns: async (databaseId, tableId) =>
      ((await listOrEmpty(() => clients.tablesDB.listColumns({ databaseId, tableId }), { columns: [], total: 0 })) as { columns: { key: string; status?: string; type?: string; format?: string; elements?: string[]; size?: number; required?: boolean }[] }).columns.map(
        (column) => ({
          key: column.key,
          status: column.status,
          kind: column.type,
          format: column.format,
          elements: column.elements,
          size: column.size,
          required: column.required,
        }),
      ),
    listIndexes: async (databaseId, tableId) =>
      ((await listOrEmpty(() => clients.tablesDB.listIndexes({ databaseId, tableId }), { indexes: [], total: 0 })) as { indexes: { key: string; status?: string }[] }).indexes.map(
        (index) => ({ key: index.key, status: index.status }),
      ),
    getBucket: (bucketId) => { const storage = clients.storage; return storage ? optional(() => storage.getBucket({ bucketId })) : Promise.resolve(undefined); },
    getFunction: (functionId) => { const functions = clients.functions; return functions ? optional(() => functions.get({ functionId })) : Promise.resolve(undefined); },
    getSchemaVersionRow: async () => {
      try {
        const row = await clients.tablesDB.getRow({ databaseId: DATABASE_ID, tableId: "schema_metadata", rowId: SCHEMA_METADATA_ROW_ID });
        return { version: Number(row.version) };
      } catch (error) {
        if (error instanceof AppwriteException && error.code === 404) return undefined;
        throw error;
      }
    },
  };
}

export interface PlannedTable {
  readonly table: TableDefinition;
  readonly tableExists: boolean;
  readonly columns: readonly ColumnDefinition[];
  readonly indexes: readonly IndexDefinition[];
}

export interface SafeStringCapacityIncrease {
  readonly tableId: string;
  readonly columnKey: string;
  readonly fromSize: number;
  readonly toSize: number;
  readonly required: boolean;
}

const PROVISIONING_STATUSES = ["processing"];
const FATAL_PROVISIONING_STATUSES = ["failed", "stuck", "deleting"];

function enumElementsMatch(existing: readonly string[] | undefined, desired: readonly string[] | undefined): boolean {
  return existing !== undefined && desired !== undefined &&
    existing.length === desired.length &&
    existing.every((element, index) => element === desired[index]);
}

function columnTypeDrift(existing: ExistingColumn, desired: ColumnDefinition): string | undefined {
  if (desired.kind === "enum") {
    if (existing.kind !== "string" || existing.format !== "enum" || !Array.isArray(existing.elements)) {
      return `provider type '${existing.kind ?? "unknown"}' format '${existing.format ?? "none"}' does not identify the column as enum`;
    }
    if (!enumElementsMatch(existing.elements, desired.elements)) {
      return `provider enum elements do not exactly match the desired enum elements`;
    }
    return undefined;
  }
  if (existing.kind !== undefined && existing.kind !== desired.kind) {
    return `type is '${existing.kind}', expected '${desired.kind}'`;
  }
  if (existing.format === "enum" || existing.elements !== undefined) {
    return `provider enum metadata is incompatible with desired type '${desired.kind}'`;
  }
  return undefined;
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
  readonly metadataRowVersion?: number;
  readonly createMetadataRow: boolean;
  readonly provisioning: readonly string[];
  readonly errors: readonly string[];
  readonly drifts: readonly string[];
  readonly safeStringCapacityIncreases: readonly SafeStringCapacityIncrease[];
}

export async function planSchemaApplication(reader: AppwriteSchemaReader): Promise<SchemaPlan> {
  const drifts: string[] = [];
  const errors: string[] = [];
  const provisioning: string[] = [];
  const safeStringCapacityIncreases: SafeStringCapacityIncrease[] = [];
  const database = await reader.getDatabase(DATABASE_ID);
  if (database && database.id !== DATABASE_ID) drifts.push(`Database identifier mismatch: ${database.id}.`);
  const existingTables = new Set((await reader.listTables(DATABASE_ID)).map((table) => table.id));
  const plannedTables: PlannedTable[] = [];
  const complete: string[] = [];
  for (const definition of TABLES) {
    if (!existingTables.has(definition.id)) {
      plannedTables.push({ columns: definition.columns, indexes: definition.indexes, table: definition, tableExists: false });
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
    for (const column of definition.columns) {
      const existing = existingColumns.find((candidate) => candidate.key === column.key);
      const state = existing?.status;
      if (state !== undefined && PROVISIONING_STATUSES.includes(state)) provisioning.push(`${definition.id}.column:${column.key}`);
      if (state !== undefined && FATAL_PROVISIONING_STATUSES.includes(state)) errors.push(`Column ${definition.id}.${column.key} is in provider state '${state}'.`);
      if (!existing) continue;
      const typeDrift = columnTypeDrift(existing, column);
      if (typeDrift) {
        drifts.push(`Column ${definition.id}.${column.key} ${typeDrift}; type changes are refused.`);
        continue;
      }
      if (existing.required !== undefined && existing.required !== column.required) {
        drifts.push(`Column ${definition.id}.${column.key} required=${existing.required}, expected ${column.required}; required-state changes are refused.`);
      }
      if (column.kind !== "string" || column.size === undefined || existing.size === undefined || existing.size === column.size) continue;
      if (existing.size > column.size) {
        drifts.push(`Column ${definition.id}.${column.key} capacity ${existing.size} exceeds desired ${column.size}; capacity decreases are refused.`);
        continue;
      }
      const approved = SAFE_STRING_CAPACITY_INCREASES.some(
        (migration) =>
          migration.tableId === definition.id &&
          migration.columnKey === column.key &&
          migration.fromSize === existing.size &&
          migration.toSize === column.size &&
          migration.schemaVersion === SCHEMA_VERSION,
      );
      if (!approved) {
        drifts.push(`Column ${definition.id}.${column.key} capacity increase ${existing.size} -> ${column.size} is not explicitly approved.`);
        continue;
      }
      safeStringCapacityIncreases.push({
        tableId: definition.id,
        columnKey: column.key,
        fromSize: existing.size,
        toSize: column.size,
        required: column.required,
      });
    }
    for (const index of definition.indexes) {
      const state = existingIndexes.find((existing) => existing.key === index.key)?.status;
      if (state !== undefined && PROVISIONING_STATUSES.includes(state)) provisioning.push(`${definition.id}.index:${index.key}`);
      if (state !== undefined && FATAL_PROVISIONING_STATUSES.includes(state)) errors.push(`Index ${definition.id}.${index.key} is in provider state '${state}'.`);
    }
    if (missingColumns.length > 0 || missingIndexes.length > 0) {
      plannedTables.push({ columns: missingColumns, indexes: missingIndexes, table: definition, tableExists: true });
    }
    if (unexpectedColumns.length > 0) {
      drifts.push(`Table ${definition.id} has unmanaged columns: ${unexpectedColumns.map((column) => column.key).join(", ")}.`);
    }
    const fullyCorrect =
      missingColumns.length === 0 &&
      missingIndexes.length === 0 &&
      unexpectedColumns.length === 0 &&
      !safeStringCapacityIncreases.some((operation) => operation.tableId === definition.id) &&
      !drifts.some((entry) => entry.startsWith(`Column ${definition.id}.`) || entry.startsWith(`Table ${definition.id} `)) &&
      !provisioning.some((resource) => resource.startsWith(`${definition.id}.`)) &&
      !errors.some((entry) => entry.startsWith(`Column ${definition.id}.`) || entry.startsWith(`Index ${definition.id}.`));
    if (fullyCorrect) complete.push(definition.id);
  }
  const [bucket, maintenance] = await Promise.all([reader.getBucket(BUCKET.id), reader.getFunction(MAINTENANCE_FUNCTION.id)]);
  const metadataRow = existingTables.has("schema_metadata") ? await reader.getSchemaVersionRow() : undefined;
  return {
    createBucket: !bucket,
    createDatabase: !database,
    createFunction: !maintenance,
    createMetadataRow: metadataRow === undefined || metadataRow.version !== SCHEMA_VERSION,
    databaseExists: Boolean(database),
    drifts,
    errors,
    provisioning,
    existingCompleteTables: complete,
    functionExists: Boolean(maintenance),
    bucketExists: Boolean(bucket),
    metadataRowVersion: metadataRow?.version,
    safeStringCapacityIncreases,
    tables: plannedTables,
  };
}
