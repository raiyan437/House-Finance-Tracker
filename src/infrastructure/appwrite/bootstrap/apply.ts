import { AppwriteException, ProjectKeyScopes, Runtime, TablesDBIndexType, type TablesDB, type Storage, type Functions } from "node-appwrite";
import {
  BUCKET,
  DATABASE_ID,
  MAINTENANCE_FUNCTION,
  SCHEMA_METADATA_ROW_ID,
  SCHEMA_VERSION,
  TABLES,
  type ColumnDefinition,
} from "../schema/definitions";
import type { SchemaPlan } from "./planner";

export interface AppwriteBootstrapClients {
  readonly tablesDB: TablesDB;
  readonly storage: Storage;
  readonly functions: Functions;
}

export interface SchemaApplicationOptions {
  readonly dryRun: boolean;
  readonly pollIntervalMs?: number;
  readonly barrierTimeoutMs?: number;
}

export interface SchemaApplicationResult {
  readonly performed: readonly string[];
  readonly skipped: readonly string[];
}

const NO_PERMISSIONS: string[] = [];
const COLUMN_AVAILABLE = "available";
const INDEX_AVAILABLE = "available";
const FATAL_STATUSES = ["failed", "stuck", "deleting"];

export class BootstrapProvisioningTimeoutError extends Error {
  constructor(readonly resourceType: string, readonly resourceName: string, readonly lastStatuses: Record<string, string | undefined>) {
    super(
      `APPWRITE_RESOURCE_PROVISIONING_TIMEOUT: ${resourceType} '${resourceName}' did not reach available in time. Last statuses: ` +
        Object.entries(lastStatuses).map(([key, status]) => `${key}=${status ?? "unknown"}`).join(", "),
    );
  }
}

export class BootstrapFatalProvisioningError extends Error {
  constructor(readonly details: readonly string[]) {
    super("APPWRITE_FATAL_PROVISIONING_STATE: " + details.join(" | "));
  }
}

function isTransientColumnNotAvailable(error: unknown): boolean {
  const candidate = error as { type?: string; code?: number; message?: string } | null;
  if (!candidate || typeof candidate !== "object") return false;
  const providerShaped = error instanceof AppwriteException || (typeof candidate.code === "number" && typeof candidate.type === "string");
  return providerShaped && (candidate.type === "column_not_available" || (candidate.code === 400 && /not yet available/i.test(String(candidate.message))));
}

function assertNotFatal(kind: string, resource: string, status: string | undefined): void {
  if (status !== undefined && FATAL_STATUSES.includes(status)) {
    throw new BootstrapFatalProvisioningError([`${kind} '${resource}' reached provider state '${status}'.`]);
  }
}

export async function applySchemaPlan(
  plan: SchemaPlan,
  clients: AppwriteBootstrapClients,
  options: SchemaApplicationOptions,
): Promise<SchemaApplicationResult> {
  const intervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.barrierTimeoutMs ?? 60000;
  const performed: string[] = [];
  const skipped = [
    ...plan.drifts.map((drift) => `report-only drift: ${drift}`),
    ...plan.provisioning.map((resource) => `provisioning-wait: ${resource}`),
    ...plan.errors.map((error) => `fatal-state: ${error}`),
  ];
  if (options.dryRun) {
    if (plan.createDatabase) performed.push(`database:create ${DATABASE_ID}`);
    for (const operation of plan.safeStringCapacityIncreases) {
      performed.push(`column:widen ${operation.tableId}.${operation.columnKey} (string ${operation.fromSize} -> ${operation.toSize})`);
    }
    for (const entry of plan.tables) {
      performed.push(`table:create ${entry.table.id} (${entry.columns.length} columns, ${entry.indexes.length} indexes)`);
      for (const column of entry.columns) performed.push(`column:create ${entry.table.id}.${column.key} (${column.kind})`);
      for (const index of entry.indexes) performed.push(`index:create ${entry.table.id}.${index.key} (${index.type})`);
    }
    if (plan.createBucket) performed.push(`bucket:create ${BUCKET.id} (private, deny-by-default)`);
    if (plan.createFunction) performed.push(`function:create ${MAINTENANCE_FUNCTION.id}`);
    if (plan.createMetadataRow) performed.push(`schema_metadata:upsert ${SCHEMA_METADATA_ROW_ID} (version ${SCHEMA_VERSION})`);
    return { performed, skipped };
  }

  if (plan.errors.length > 0) throw new BootstrapFatalProvisioningError(plan.errors);
  if (plan.drifts.length > 0) {
    throw new BootstrapFatalProvisioningError(plan.drifts.map((drift) => `Refused schema drift: ${drift}`));
  }

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function barrier(resourceType: string, resourceName: string, readStatuses: () => Promise<Record<string, string | undefined>>, requiredKeys: readonly string[]): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastStatuses: Record<string, string | undefined> = {};
    while (Date.now() < deadline) {
      lastStatuses = await readStatuses();
      for (const key of requiredKeys) assertNotFatal(`${resourceType} column`, `${resourceName}.${key}`, lastStatuses[key]);
      if (requiredKeys.every((key) => lastStatuses[key] === (resourceType === "index" ? INDEX_AVAILABLE : COLUMN_AVAILABLE))) return;
      await wait(intervalMs);
    }
    throw new BootstrapProvisioningTimeoutError(resourceType, resourceName, lastStatuses);
  }

  async function columnBarrier(tableId: string, columns: readonly ColumnDefinition[]): Promise<void> {
    await barrier(
      "column",
      tableId,
      async () => {
        const response = (await listOrEmpty(() => clients.tablesDB.listColumns({ databaseId: DATABASE_ID, tableId }), { columns: [], total: 0 })) as { columns: { key: string; status?: string }[] };
        return Object.fromEntries(response.columns.map((column) => [column.key, column.status]));
      },
      columns.map((column) => column.key),
    );
  }

  async function indexBarrier(tableId: string, indexKeys: readonly string[]): Promise<void> {
    await barrier(
      "index",
      tableId,
      async () => {
        const response = (await listOrEmpty(() => clients.tablesDB.listIndexes({ databaseId: DATABASE_ID, tableId }), { indexes: [], total: 0 })) as { indexes: { key: string; status?: string }[] };
        return Object.fromEntries(response.indexes.map((index) => [index.key, index.status]));
      },
      indexKeys,
    );
  }

  async function stringCapacityBarrier(tableId: string, columnKey: string, expectedSize: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastStatus: string | undefined;
    let lastSize: number | undefined;
    while (Date.now() < deadline) {
      const response = (await clients.tablesDB.listColumns({ databaseId: DATABASE_ID, tableId })) as {
        columns: { key: string; status?: string; size?: number }[];
      };
      const column = response.columns.find((candidate) => candidate.key === columnKey);
      lastStatus = column?.status;
      lastSize = column?.size;
      assertNotFatal("column", `${tableId}.${columnKey}`, lastStatus);
      if (lastStatus === COLUMN_AVAILABLE && lastSize === expectedSize) return;
      await wait(intervalMs);
    }
    throw new BootstrapProvisioningTimeoutError("string-capacity", `${tableId}.${columnKey}`, {
      status: lastStatus,
      size: lastSize === undefined ? undefined : String(lastSize),
    });
  }

  async function listOrEmpty<T>(call: () => Promise<T>, empty: T): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof AppwriteException && error.code === 404) return empty;
      throw error;
    }
  }

  if (plan.createDatabase) {
    await clients.tablesDB.create({ databaseId: DATABASE_ID, name: "House Finance Tracker" });
    performed.push(`database:create ${DATABASE_ID}`);
  }
  for (const operation of plan.safeStringCapacityIncreases) {
    await clients.tablesDB.updateStringColumn({
      databaseId: DATABASE_ID,
      tableId: operation.tableId,
      key: operation.columnKey,
      required: operation.required,
      xdefault: null,
      size: operation.toSize,
    });
    performed.push(`column:widen ${operation.tableId}.${operation.columnKey} (${operation.fromSize} -> ${operation.toSize})`);
    await stringCapacityBarrier(operation.tableId, operation.columnKey, operation.toSize);
  }
  for (const entry of plan.tables) {
    if (!entry.tableExists) {
      await clients.tablesDB.createTable({ databaseId: DATABASE_ID, tableId: entry.table.id, name: entry.table.name });
      performed.push(`table:create ${entry.table.id}`);
    }
    for (const column of entry.columns) {
      await createColumn(clients.tablesDB, entry.table.id, column);
      performed.push(`column:create ${entry.table.id}.${column.key}`);
    }
    if (entry.columns.length > 0) await columnBarrier(entry.table.id, entry.columns);
    for (const index of entry.indexes) {
      try {
        await clients.tablesDB.createIndex({
          databaseId: DATABASE_ID,
          tableId: entry.table.id,
          key: index.key,
          type: index.type === "unique" ? TablesDBIndexType.Unique : TablesDBIndexType.Key,
          columns: [...index.columns],
        });
        performed.push(`index:create ${entry.table.id}.${index.key}`);
      } catch (error) {
        if (!isTransientColumnNotAvailable(error)) throw error;
        await columnBarrier(entry.table.id, entry.table.columns.filter((column) => index.columns.includes(column.key)));
        await clients.tablesDB.createIndex({
          databaseId: DATABASE_ID,
          tableId: entry.table.id,
          key: index.key,
          type: index.type === "unique" ? TablesDBIndexType.Unique : TablesDBIndexType.Key,
          columns: [...index.columns],
        });
        performed.push(`index:create ${entry.table.id}.${index.key} (after column-ready reread)`);
      }
    }
    if (entry.indexes.length > 0) await indexBarrier(entry.table.id, entry.indexes.map((index) => index.key));
    performed.push(`table:complete ${entry.table.id}`);
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

  for (const table of TABLES) {
    await columnBarrier(table.id, table.columns);
    await indexBarrier(table.id, table.indexes.map((index) => index.key));
  }
  if (plan.createMetadataRow) {
    await clients.tablesDB.upsertRow({
      databaseId: DATABASE_ID,
      tableId: "schema_metadata",
      rowId: SCHEMA_METADATA_ROW_ID,
      data: { version: SCHEMA_VERSION, appliedAt: new Date().toISOString() },
    });
    performed.push(`schema_metadata:upsert ${SCHEMA_METADATA_ROW_ID} (version ${SCHEMA_VERSION})`);
  }
  return { performed, skipped };
}

async function createColumn(tablesDB: TablesDB, tableId: string, column: ColumnDefinition): Promise<void> {
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
