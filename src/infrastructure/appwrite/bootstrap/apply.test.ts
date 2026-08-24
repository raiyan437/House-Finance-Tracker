import { describe, expect, it } from "vitest";
import type { Functions, Storage, TablesDB } from "node-appwrite";
import { BUCKET, DATABASE_ID, MAINTENANCE_FUNCTION, SCHEMA_METADATA_ROW_ID, SCHEMA_VERSION, TABLES } from "../schema/definitions";
import { planSchemaApplication, type AppwriteSchemaReader } from "./planner";
import { applySchemaPlan, type AppwriteBootstrapClients } from "./apply";

function emptyReader(): AppwriteSchemaReader {
  return {
    getDatabase: async () => undefined,
    listTables: async () => [],
    listColumns: async () => [],
    listIndexes: async () => [],
    getBucket: async () => undefined,
    getFunction: async () => undefined,
    getSchemaVersionRow: async () => undefined,
  };
}

function recordingClients(): AppwriteBootstrapClients & { calls: string[] } {
  const calls: string[] = [];
  const columns: { tableId: string; key: string; status: string }[] = [];
  const indexes: { tableId: string; key: string; status: string }[] = [];
  const tablesDB = {
    create: async ({ databaseId }: { databaseId: string }) => {
      calls.push(`db:${databaseId}`);
    },
    createTable: async ({ tableId }: { tableId: string }) => {
      calls.push(`table:${tableId}`);
    },
    listColumns: async ({ tableId }: { tableId: string }) => ({
      columns: columns.filter((column) => column.tableId === tableId).map(({ key, status }) => ({ key, status })),
      total: 0,
    }),
    listIndexes: async ({ tableId }: { tableId: string }) => ({
      indexes: indexes.filter((index) => index.tableId === tableId).map(({ key, status }) => ({ key, status })),
      total: 0,
    }),
    createStringColumn: async ({ tableId, key }: { tableId: string; key: string }) => {
      calls.push(`col:str:${tableId}.${key}`);
      columns.push({ tableId, key, status: "available" });
    },
    createBigIntColumn: async ({ tableId, key }: { tableId: string; key: string }) => {
      calls.push(`col:bigint:${tableId}.${key}`);
      columns.push({ tableId, key, status: "available" });
    },
    createIntegerColumn: async ({ tableId, key }: { tableId: string; key: string }) => {
      calls.push(`col:int:${tableId}.${key}`);
      columns.push({ tableId, key, status: "available" });
    },
    createDatetimeColumn: async ({ tableId, key }: { tableId: string; key: string }) => {
      calls.push(`col:dt:${tableId}.${key}`);
      columns.push({ tableId, key, status: "available" });
    },
    createEnumColumn: async ({ tableId, key }: { tableId: string; key: string }) => {
      calls.push(`col:enum:${tableId}.${key}`);
      columns.push({ tableId, key, status: "available" });
    },
    createIndex: async ({ tableId, key }: { tableId: string; key: string }) => {
      calls.push(`index:${tableId}.${key}`);
      indexes.push({ tableId, key, status: "available" });
    },
    upsertRow: async ({ rowId }: { rowId: string }) => {
      calls.push(`row:${rowId}`);
    },
  } as unknown as TablesDB;
  const storage = {
    createBucket: async ({ bucketId }: { bucketId: string }) => {
      calls.push(`bucket:${bucketId}`);
    },
  } as unknown as Storage;
  const functions = {
    create: async ({ functionId }: { functionId: string }) => {
      calls.push(`fn:${functionId}`);
    },
  } as unknown as Functions;
  return { tablesDB, storage, functions, calls };
}

describe("schema bootstrap applier", () => {
  it("performs no remote calls during dry-run and still reports the full ordered plan", async () => {
    const clients = recordingClients();
    const plan = await planSchemaApplication(emptyReader());
    const result = await applySchemaPlan(plan, clients, { dryRun: true });
    expect(clients.calls).toEqual([]);
    expect(result.performed[0]).toBe(`database:create ${DATABASE_ID}`);
    expect(result.performed).toContain(`column:create expenses.amountPoisha (bigint)`);
    expect(result.performed).toContain(`bucket:create ${BUCKET.id} (private, deny-by-default)`);
    expect(result.performed.at(-1)).toBe(`schema_metadata:upsert ${SCHEMA_METADATA_ROW_ID} (version ${SCHEMA_VERSION})`);
    expect(result.performed.filter((action) => action.startsWith("table:create")).length).toBe(TABLES.length);
  });

  it("creates resources in dependency order with columns before indexes and metadata last", async () => {
    const clients = recordingClients();
    const plan = await planSchemaApplication(emptyReader());
    await applySchemaPlan(plan, clients, { dryRun: false });
    expect(clients.calls.indexOf(`table:expenses`)).toBeLessThan(clients.calls.indexOf(`col:bigint:expenses.amountPoisha`));
    expect(clients.calls.indexOf(`col:str:expenses.expenseDate`)).toBeLessThan(clients.calls.indexOf(`index:expenses.by_household_expense_date`));
    expect(clients.calls.indexOf(`fn:${MAINTENANCE_FUNCTION.id}`)).toBeLessThan(clients.calls.indexOf(`row:${SCHEMA_METADATA_ROW_ID}`));
    expect(clients.calls.at(-1)).toBe(`row:${SCHEMA_METADATA_ROW_ID}`);
    expect(clients.calls.filter((call) => call.startsWith("bucket:"))).toEqual([`bucket:${BUCKET.id}`]);
  });
});
