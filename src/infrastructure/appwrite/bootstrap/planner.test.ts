import { describe, expect, it } from "vitest";
import { BUCKET, DATABASE_ID, MAINTENANCE_FUNCTION, TABLES } from "../schema/definitions";
import { planSchemaApplication, type AppwriteSchemaReader } from "./planner";

function readerFrom(state: {
  database?: boolean;
  tables?: Partial<Record<string, { columns?: string[]; indexes?: string[]; extraColumns?: string[] }>>;
  bucket?: boolean;
  fn?: boolean;
}): AppwriteSchemaReader {
  return {
    getDatabase: async () => (state.database ? { id: DATABASE_ID } : undefined),
    listTables: async () => Object.keys(state.tables ?? {}).map((id) => ({ id })),
    listColumns: async (_db, tableId) => {
      const entry = state.tables?.[tableId];
      if (!entry) throw new Error(`unexpected table probe ${tableId}`);
      const definition = TABLES.find((table) => table.id === tableId)!;
      const known = entry.columns ?? definition.columns.map((column) => column.key);
      return [...known.map((key) => ({ key })), ...(entry.extraColumns ?? []).map((key) => ({ key }))].filter(
        (column) => column.key !== "$id",
      );
    },
    listIndexes: async (_db, tableId) => {
      const entry = state.tables?.[tableId];
      if (!entry) throw new Error(`unexpected index probe ${tableId}`);
      const definition = TABLES.find((table) => table.id === tableId)!;
      const known = entry.indexes ?? definition.indexes.map((index) => index.key);
      return known.map((key) => ({ key }));
    },
    getBucket: async () => (state.bucket ? { id: BUCKET.id } : undefined),
    getFunction: async () => (state.fn ? { id: MAINTENANCE_FUNCTION.id } : undefined),
  };
}

const EMPTY_STATE = readerFrom({});

describe("schema bootstrap planner", () => {
  it("plans every resource as a create against an empty project", async () => {
    const plan = await planSchemaApplication(EMPTY_STATE);
    expect(plan.createDatabase).toBe(true);
    expect(plan.createBucket).toBe(true);
    expect(plan.createFunction).toBe(true);
    expect(plan.tables.map((entry) => entry.table.id)).toEqual(TABLES.map((table) => table.id));
    expect(plan.drifts).toEqual([]);
    const expenses = plan.tables.find((entry) => entry.table.id === "expenses")!;
    expect(expenses.columns.map((column) => column.kind)).toContain("bigint");
  });

  it("stages only missing pieces for a partially applied project and never mutates existing columns", async () => {
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables: { households: {} } }));
    expect(plan.createDatabase).toBe(false);
    expect(plan.createBucket).toBe(false);
    expect(plan.createFunction).toBe(false);
    expect(plan.tables.map((entry) => entry.table.id)).toEqual(TABLES.map((table) => table.id).filter((id) => id !== "households"));
    expect(plan.tables.find((entry) => entry.table.id === "households")).toBeUndefined();
    expect(plan.existingCompleteTables).toContain("households");
  });

  it("reports unmanaged columns as report-only drift without planning destructive operations", async () => {
    const plan = await planSchemaApplication(readerFrom({ database: true, tables: { profiles: { extraColumns: ["legacy_email"] } } }));
    expect(plan.drifts.join(" ")).toMatch(/profiles.*legacy_email/);
    expect(plan.tables.filter((entry) => entry.table.id === "profiles").length).toBe(0);
  });

  it("never emits deletion or mutation verbs in any planned operation", async () => {
    const plan = await planSchemaApplication(EMPTY_STATE);
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toMatch(/\b(delete|drop|truncate)\b/i);
  });
});
