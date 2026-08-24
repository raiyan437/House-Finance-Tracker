import { describe, expect, it } from "vitest";
import type { Functions, Storage, TablesDB } from "node-appwrite";
import { TABLES } from "../schema/definitions";
import { planSchemaApplication, type AppwriteSchemaReader } from "./planner";
import { applySchemaPlan, BootstrapFatalProvisioningError, type AppwriteBootstrapClients } from "./apply";

const FAST = { dryRun: false, pollIntervalMs: 1, barrierTimeoutMs: 250 };

interface FakeColumnState {
  key: string;
  status?: string;
}

interface FakeIndexState {
  key: string;
  status?: string;
}

type FakeTables = Record<string, { columns: FakeColumnState[]; indexes: FakeIndexState[] }>;

function allAvailable(): FakeTables {
  return Object.fromEntries(
    TABLES.map((table) => [
      table.id,
      {
        columns: table.columns.map((column) => ({ key: column.key, status: "available" })),
        indexes: table.indexes.map((index) => ({ key: index.key, status: "available" })),
      },
    ]),
  );
}

function makeFakeBackend(tables: FakeTables = {}) {
  const state = {
    database: Object.keys(tables).length > 0,
    tables: structuredClone(tables),
    calls: [] as string[],
    failIndexOnceWithTransient: false,
    holdProcessing: false,
  };
  const pushColumn = async ({ tableId, key }: { tableId: string; key: string }) => {
    state.calls.push(`column:create:${tableId}.${key}`);
    state.tables[tableId]?.columns.push({ key, status: "processing" });
  };
  const tablesDB = {
    create: async () => {
      state.database = true;
      state.calls.push("database:create");
    },
    get: async () => ({ $id: "hft" }),
    listTables: async () => ({ tables: Object.keys(state.tables).map(($id) => ({ $id })), total: 0 }),
    createTable: async ({ tableId }: { tableId: string }) => {
      state.tables[tableId] = { columns: [], indexes: [] };
      state.calls.push(`table:create:${tableId}`);
    },
    listColumns: async ({ tableId }: { tableId: string }) => ({
      columns: (state.tables[tableId]?.columns ?? []).map((column) =>
        column.status === "processing" && !state.holdProcessing ? { key: column.key, status: "available" } : column,
      ),
      total: 0,
    }),
    listIndexes: async ({ tableId }: { tableId: string }) => ({
      indexes: (state.tables[tableId]?.indexes ?? []).map((index) =>
        index.status === "processing" && !state.holdProcessing ? { key: index.key, status: "available" } : index,
      ),
      total: 0,
    }),
    createStringColumn: pushColumn,
    createBigIntColumn: pushColumn,
    createIntegerColumn: pushColumn,
    createDatetimeColumn: pushColumn,
    createEnumColumn: pushColumn,
    createBooleanColumn: pushColumn,
    createIndex: async ({ tableId, key }: { tableId: string; key: string }) => {
      if (state.failIndexOnceWithTransient) {
        state.failIndexOnceWithTransient = false;
        const error = new Error("The requested column 'status' is not yet available. Please try again later.") as Error & {
          code: number;
          type: string;
        };
        error.code = 400;
        error.type = "column_not_available";
        throw error;
      }
      state.calls.push(`index:create:${tableId}.${key}`);
      state.tables[tableId]?.indexes.push({ key, status: "processing" });
    },
    upsertRow: async ({ rowId }: { rowId: string }) => {
      state.calls.push(`row:schema_metadata.${rowId}`);
    },
  } as unknown as TablesDB;
  return {
    state,
    clients: {
      tablesDB,
      storage: {
        createBucket: async ({ bucketId }: { bucketId: string }) => {
          state.calls.push(`bucket:create:${bucketId}`);
        },
      } as unknown as Storage,
      functions: {
        create: async ({ functionId }: { functionId: string }) => {
          state.calls.push(`function:create:${functionId}`);
        },
      } as unknown as Functions,
      calls: state.calls,
    } satisfies AppwriteBootstrapClients & { calls: string[] },
  };
}

function readerFrom(backend: Readonly<{ database: boolean; tables: Record<string, { columns?: FakeColumnState[]; indexes?: FakeIndexState[] }> }>): AppwriteSchemaReader {
  return {
    getDatabase: async () => (backend.database ? { id: "hft" } : undefined),
    listTables: async () => Object.keys(backend.tables).map((id) => ({ id })),
    listColumns: async (_db, tableId) =>
      (backend.tables[tableId]?.columns ?? []).map((column) => ({ key: column.key, status: column.status })),
    listIndexes: async (_db, tableId) =>
      (backend.tables[tableId]?.indexes ?? []).map((index) => ({ key: index.key, status: index.status })),
    getBucket: async () => undefined,
    getFunction: async () => undefined,
    getSchemaVersionRow: async () => undefined,
  };
}

describe("provider-readiness provisioning", () => {
  it("waits for processing columns to become available before completing a table", async () => {
    const fake = makeFakeBackend();
    fake.state.holdProcessing = true;
    const plan = await planSchemaApplication(readerFrom(fake.state));
    setTimeout(() => {
      fake.state.holdProcessing = false;
    }, 25);
    const result = await applySchemaPlan(plan, fake.clients, { dryRun: false, pollIntervalMs: 2, barrierTimeoutMs: 1000 });
    expect(result.performed.filter((action) => action.startsWith("table:complete")).length).toBe(TABLES.length);
    expect(result.performed.at(-1)).toContain("schema_metadata:upsert");
  });

  it("stops immediately when a column reaches a fatal provider state and withholds schema metadata", async () => {
    const tables = allAvailable();
    tables.memberships.columns = tables.memberships.columns.map((column) =>
      column.key === "status" ? { key: "status", status: "failed" } : column,
    );
    const fake = makeFakeBackend(tables);
    const plan = await planSchemaApplication(readerFrom(fake.state));
    await expect(applySchemaPlan(plan, fake.clients, FAST)).rejects.toBeInstanceOf(BootstrapFatalProvisioningError);
    expect(fake.state.calls.some((call) => call.startsWith("row:schema_metadata"))).toBe(false);
  });

  it.each(["stuck", "deleting"])("classifies %s columns as fatal during planning", async (status) => {
    const tables = allAvailable();
    tables.cards.columns = tables.cards.columns.map((column) => (column.key === "ownerId" ? { ...column, status } : column));
    const plan = await planSchemaApplication(readerFrom({ database: true, tables }));
    expect(plan.errors.join(" ")).toContain("cards.ownerId");
    expect(plan.existingCompleteTables).not.toContain("cards");
  });

  it("reports processing resources as provisioning rather than already correct", async () => {
    const tables = allAvailable();
    tables.profiles.columns = tables.profiles.columns.map((column) => ({ ...column, status: "processing" }));
    const plan = await planSchemaApplication(readerFrom({ database: true, tables }));
    expect(plan.provisioning.some((resource) => resource === "profiles.column:displayName")).toBe(true);
    expect(plan.existingCompleteTables).not.toContain("profiles");
    expect(plan.errors).toEqual([]);
  });

  it("raises APPWRITE_RESOURCE_PROVISIONING_TIMEOUT when a column never becomes available", async () => {
    const fake = makeFakeBackend();
    fake.state.holdProcessing = true;
    const plan = await planSchemaApplication(readerFrom(fake.state));
    await expect(
      applySchemaPlan(plan, fake.clients, { dryRun: false, pollIntervalMs: 1, barrierTimeoutMs: 30 }),
    ).rejects.toThrow(/APPWRITE_RESOURCE_PROVISIONING_TIMEOUT/);
    expect(fake.state.calls.some((call) => call.startsWith("row:schema_metadata"))).toBe(false);
  });

  it("recovers from a transient column_not_available race during index creation", async () => {
    const tables = allAvailable();
    tables.memberships.indexes = [];
    const fake = makeFakeBackend(tables);
    fake.state.failIndexOnceWithTransient = true;
    const plan = await planSchemaApplication(readerFrom(fake.state));
    const result = await applySchemaPlan(plan, fake.clients, FAST);
    expect(result.performed).toContain("index:create memberships.by_household_status (after column-ready reread)");
    expect(result.performed).toContain("table:complete memberships");
  });

  it("propagates non-transient index failures immediately and withholds metadata", async () => {
    const tables = allAvailable();
    tables.memberships.indexes = [];
    const fake = makeFakeBackend(tables);
    const tablesDB = fake.clients.tablesDB as unknown as { createIndex: (args: { tableId: string; key: string }) => Promise<void> };
    let attempts = 0;
    tablesDB.createIndex = async (args) => {
      attempts += 1;
      if (args.tableId === "memberships") throw new Error("Malformed index attribute.");
      fake.state.calls.push(`index:create:${args.tableId}.${args.key}`);
      fake.state.tables[args.tableId]?.indexes.push({ key: args.key, status: "available" });
    };
    const plan = await planSchemaApplication(readerFrom(fake.state));
    expect(plan.tables.find((entry) => entry.table.id === "memberships")?.indexes.length).toBe(3);
    await expect(applySchemaPlan(plan, fake.clients, FAST)).rejects.toThrow(/Malformed index attribute/);
    expect(attempts).toBe(1);
    expect(fake.state.calls.some((call) => call.startsWith("row:schema_metadata"))).toBe(false);
  });

  it("resumes the accepted partial project without duplicating or deleting anything", async () => {
    const available = allAvailable();
    delete available.memberships;
    delete available.settlements;
    const partial: FakeTables = {};
    for (const id of ["profiles", "households"] as const) partial[id] = available[id];
    partial.memberships = {
      columns: TABLES.find((table) => table.id === "memberships")!.columns.map((column) => ({ key: column.key, status: "available" })),
      indexes: [{ key: "by_household_status", status: "available" }],
    };
    const fake = makeFakeBackend(partial);
    const plan = await planSchemaApplication(readerFrom(fake.state));
    expect(plan.existingCompleteTables).toEqual(["profiles", "households"]);
    const membershipEntry = plan.tables.find((entry) => entry.table.id === "memberships");
    expect(membershipEntry?.columns ?? []).toEqual([]);
    expect(membershipEntry?.indexes.map((index) => index.key)).toEqual(["by_user_status", "by_household_user"]);
    await applySchemaPlan(plan, fake.clients, FAST);
    const membershipCreates = fake.state.calls.filter((call) => call.includes(":create:memberships"));
    expect(membershipCreates.length).toBeGreaterThan(0);
    expect(membershipCreates.every((call) => call.startsWith("index:create"))).toBe(true);
    expect(fake.state.calls.filter((call) => call === "database:create").length).toBe(0);
    expect(fake.state.calls.filter((call) => call.startsWith("row:schema_metadata")).length).toBe(1);
  });
});
