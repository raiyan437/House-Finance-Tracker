import { ProjectKeyScopes, Runtime, TablesDBIndexType, type TablesDB, type Storage, type Functions } from "node-appwrite";
import { DATABASE_ID, BUCKET, MAINTENANCE_FUNCTION } from "../schema/definitions";
import type { SchemaPlan } from "./planner";

export interface AppwriteBootstrapClients {
  readonly tablesDB: TablesDB;
  readonly storage: Storage;
  readonly functions: Functions;
}

export interface SchemaApplicationOptions {
  readonly dryRun: boolean;
}

export interface SchemaApplicationResult {
  readonly performed: readonly string[];
  readonly skipped: readonly string[];
}

const NO_PERMISSIONS: string[] = [];

export async function applySchemaPlan(
  plan: SchemaPlan,
  clients: AppwriteBootstrapClients,
  options: SchemaApplicationOptions,
): Promise<SchemaApplicationResult> {
  const performed: string[] = [];
  const skipped = plan.drifts.map((drift) => `report-only drift: ${drift}`);
  if (options.dryRun) {
    if (plan.createDatabase) performed.push(`database:create ${DATABASE_ID}`);
    for (const entry of plan.tables) {
      performed.push(`table:create ${entry.table.id} (${entry.columns.length} columns, ${entry.indexes.length} indexes)`);
      for (const column of entry.columns) performed.push(`column:create ${entry.table.id}.${column.key} (${column.kind})`);
      for (const index of entry.indexes) performed.push(`index:create ${entry.table.id}.${index.key} (${index.type})`);
    }
    if (plan.createBucket) performed.push(`bucket:create ${BUCKET.id} (private, deny-by-default)`);
    if (plan.createFunction) performed.push(`function:create ${MAINTENANCE_FUNCTION.id}`);
    return { performed, skipped };
  }

  if (plan.createDatabase) {
    await clients.tablesDB.create({ databaseId: DATABASE_ID, name: "House Finance Tracker" });
    performed.push(`database:create ${DATABASE_ID}`);
  }
  for (const entry of plan.tables) {
    await clients.tablesDB.createTable({ databaseId: DATABASE_ID, tableId: entry.table.id, name: entry.table.name });
    performed.push(`table:create ${entry.table.id}`);
    for (const column of entry.columns) {
      await createColumn(clients.tablesDB, entry.table.id, column);
      performed.push(`column:create ${entry.table.id}.${column.key}`);
    }
    for (const index of entry.indexes) {
      await clients.tablesDB.createIndex({
        databaseId: DATABASE_ID,
        tableId: entry.table.id,
        key: index.key,
        type: index.type === "unique" ? TablesDBIndexType.Unique : TablesDBIndexType.Key,
        columns: [...index.columns],
      });
      performed.push(`index:create ${entry.table.id}.${index.key}`);
    }
  }
  if (plan.createBucket) {
    await clients.storage.createBucket({
      bucketId: BUCKET.id,
      name: BUCKET.name,
      fileSecurity: BUCKET.fileSecurity,
      permissions: NO_PERMISSIONS,
      maximumFileSize: BUCKET.maxFileSizeBytes,
      allowedFileExtensions: [...BUCKET.allowedExtensions],
      encryption: BUCKET.encryption,
      antivirus: BUCKET.antivirus,
    });
    performed.push(`bucket:create ${BUCKET.id} (private, deny-by-default)`);
  }
  if (plan.createFunction) {
    await clients.functions.create({
      functionId: MAINTENANCE_FUNCTION.id,
      name: MAINTENANCE_FUNCTION.name,
      runtime: Runtime.Node22,
      execute: [...MAINTENANCE_FUNCTION.execute],
      events: [],
      schedule: MAINTENANCE_FUNCTION.schedule,
      timeout: MAINTENANCE_FUNCTION.timeoutSeconds,
      logging: MAINTENANCE_FUNCTION.logging,
      entrypoint: "src/main.ts",
      commands: "npm install",
      scopes: [ProjectKeyScopes.TablesRead, ProjectKeyScopes.TablesWrite, ProjectKeyScopes.RowsRead, ProjectKeyScopes.RowsWrite, ProjectKeyScopes.FilesRead, ProjectKeyScopes.FilesWrite],
    });
    performed.push(`function:create ${MAINTENANCE_FUNCTION.id}`);
  }
  return { performed, skipped };
}

async function createColumn(tablesDB: TablesDB, tableId: string, column: import("../schema/definitions").ColumnDefinition): Promise<void> {
  switch (column.kind) {
    case "string":
      await tablesDB.createStringColumn({ databaseId: DATABASE_ID, tableId, key: column.key, size: column.size ?? 255, required: column.required, xdefault: column.required ? undefined : (column.default as string | undefined) ?? "" });
      return;
    case "bigint":
      await tablesDB.createBigIntColumn({ databaseId: DATABASE_ID, tableId, key: column.key, required: column.required, xdefault: column.required ? undefined : BigInt(0) });
      return;
    case "integer":
      await tablesDB.createIntegerColumn({ databaseId: DATABASE_ID, tableId, key: column.key, required: column.required, xdefault: column.required ? undefined : 0 });
      return;
    case "datetime":
      await tablesDB.createDatetimeColumn({ databaseId: DATABASE_ID, tableId, key: column.key, required: column.required, xdefault: undefined });
      return;
    case "boolean":
      await tablesDB.createBooleanColumn({ databaseId: DATABASE_ID, tableId, key: column.key, required: column.required, xdefault: column.required ? undefined : false });
      return;
    case "enum":
      await tablesDB.createEnumColumn({ databaseId: DATABASE_ID, tableId, key: column.key, elements: [...(column.elements ?? [])], required: column.required });
      return;
  }
}
