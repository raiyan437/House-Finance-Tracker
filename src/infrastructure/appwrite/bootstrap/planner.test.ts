import { describe, expect, it } from "vitest";
import {
  BUCKET,
  CARD_NAME_STORAGE_CAPACITY,
  DATABASE_ID,
  EXPENSE_NAME_STORAGE_CAPACITY,
  HOUSEHOLD_NAME_STORAGE_CAPACITY,
  MAINTENANCE_FUNCTION,
  PROFILE_DISPLAY_NAME_STORAGE_CAPACITY,
  TABLES,
} from "../schema/definitions";
import { planSchemaApplication, type AppwriteSchemaReader, type ExistingColumn } from "./planner";

function readerFrom(state: {
  database?: boolean;
  tables?: Partial<Record<string, { columns?: string[]; indexes?: string[]; extraColumns?: string[]; columnOverrides?: Record<string, Partial<ExistingColumn>> }>>;
  bucket?: boolean;
  fn?: boolean;
  schemaVersion?: number;
}): AppwriteSchemaReader {
  return {
    getDatabase: async () => (state.database ? { id: DATABASE_ID } : undefined),
    listTables: async () => Object.keys(state.tables ?? {}).map((id) => ({ id })),
    listColumns: async (_db, tableId) => {
      const entry = state.tables?.[tableId];
      if (!entry) throw new Error(`unexpected table probe ${tableId}`);
      const definition = TABLES.find((table) => table.id === tableId)!;
      const known = entry.columns ?? definition.columns.map((column) => column.key);
      return [...known.map((key) => {
        const desired = definition.columns.find((column) => column.key === key);
        return {
          key,
          kind: desired?.kind === "enum" ? "string" : desired?.kind,
          format: desired?.kind === "enum" ? "enum" : undefined,
          elements: desired?.elements,
          size: desired?.size,
          required: desired?.required,
          ...entry.columnOverrides?.[key],
        };
      }), ...(entry.extraColumns ?? []).map((key) => ({ key }))].filter(
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
    getSchemaVersionRow: async () => (state.tables?.["schema_metadata"] ? { version: state.schemaVersion ?? 1 } : undefined),
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

  it("stages only missing pieces for a partially applied project and leaves correct existing columns unchanged", async () => {
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables: { households: {} } }));
    expect(plan.createDatabase).toBe(false);
    expect(plan.createBucket).toBe(false);
    expect(plan.createFunction).toBe(false);
    expect(plan.tables.map((entry) => entry.table.id)).toEqual(TABLES.map((table) => table.id).filter((id) => id !== "households"));
    expect(plan.tables.find((entry) => entry.table.id === "households")).toBeUndefined();
    expect(plan.existingCompleteTables).toContain("households");
  });

  it("plans only the explicitly approved households.name 64 -> 16383 widening", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.households = { columnOverrides: { name: { size: 64 } } };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 2 }));
    expect(plan.safeStringCapacityIncreases).toEqual([{
      tableId: "households",
      columnKey: "name",
      fromSize: 64,
      toSize: HOUSEHOLD_NAME_STORAGE_CAPACITY,
      required: true,
    }]);
    expect(plan.tables).toEqual([]);
    expect(plan.drifts).toEqual([]);
    expect(plan.createMetadataRow).toBe(true);
  });

  it("is idempotent after the approved capacity is present", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 7 }));
    expect(plan.safeStringCapacityIncreases).toEqual([]);
    expect(plan.drifts).toEqual([]);
    expect(plan.createMetadataRow).toBe(false);
  });

  it("plans only the explicitly approved profiles.displayName 64 -> 16383 widening for Schema V5", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.profiles = { columnOverrides: { displayName: { size: 64 } } };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 4 }));
    expect(plan.safeStringCapacityIncreases).toEqual([{
      tableId: "profiles",
      columnKey: "displayName",
      fromSize: 64,
      toSize: PROFILE_DISPLAY_NAME_STORAGE_CAPACITY,
      required: true,
    }]);
    expect(plan.tables).toEqual([]);
    expect(plan.drifts).toEqual([]);
    expect(plan.provisioning).toEqual([]);
    expect(plan.errors).toEqual([]);
    expect(plan.createMetadataRow).toBe(true);
    expect(plan.metadataRowVersion).toBe(4);
  });

  it("treats the approved profiles.displayName capacity as already correct", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 7 }));
    expect(plan.safeStringCapacityIncreases).toEqual([]);
    expect(plan.tables).toEqual([]);
    expect(plan.drifts).toEqual([]);
    expect(plan.createMetadataRow).toBe(false);
  });

  it("plans exactly the additive Profile avatar fields and metadata bump from clean Schema V5", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.profiles = {
      columns: TABLES.find((table) => table.id === "profiles")!.columns
        .map((column) => column.key)
        .filter((key) => key !== "avatarFileId" && key !== "avatarUpdatedAt"),
    };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 5 }));
    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]).toMatchObject({
      tableExists: true,
      table: { id: "profiles" },
      columns: [
        { key: "avatarFileId", kind: "string", size: 64, required: false },
        { key: "avatarUpdatedAt", kind: "datetime", required: false },
      ],
      indexes: [],
    });
    expect(plan.safeStringCapacityIncreases).toEqual([]);
    expect(plan.drifts).toEqual([]);
    expect(plan.provisioning).toEqual([]);
    expect(plan.errors).toEqual([]);
    expect(plan.createMetadataRow).toBe(true);
    expect(plan.metadataRowVersion).toBe(5);
  });

  it("refuses to shrink profiles.displayName from a capacity above the desired provider capacity", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.profiles = { columnOverrides: { displayName: { size: PROFILE_DISPLAY_NAME_STORAGE_CAPACITY + 1 } } };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 4 }));
    expect(plan.safeStringCapacityIncreases).toEqual([]);
    expect(plan.drifts.join(" ")).toMatch(/profiles\.displayName.*capacity decreases are refused/);
  });

  it("refuses Profile Display Name type and required-state drift without planning a mutation", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.profiles = { columnOverrides: { displayName: { kind: "longtext" } } };
    const typePlan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 4 }));
    expect(typePlan.safeStringCapacityIncreases).toEqual([]);
    expect(typePlan.drifts.join(" ")).toMatch(/profiles\.displayName.*type.*longtext.*expected.*string.*refused/);

    tables.profiles = { columnOverrides: { displayName: { required: false } } };
    const requiredPlan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 4 }));
    expect(requiredPlan.safeStringCapacityIncreases).toEqual([]);
    expect(requiredPlan.drifts.join(" ")).toMatch(/profiles\.displayName.*required=false.*expected true.*refused/);
  });

  it("leaves unrelated drift report-only while planning the approved Profile widening", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.profiles = { columnOverrides: { displayName: { size: 64 } } };
    tables.households = { extraColumns: ["unmanaged"] };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 4 }));
    expect(plan.safeStringCapacityIncreases).toHaveLength(1);
    expect(plan.drifts.join(" ")).toMatch(/households.*unmanaged/);
    expect(plan.tables).toEqual([]);
  });

  it("plans exactly the approved Schema V4 delta from a clean Schema V3 project", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.cards = { columnOverrides: { name: { size: 64 } } };
    tables.expenses = { columnOverrides: { name: { size: 64 } } };
    tables.expense_card_private_details = {
      columns: TABLES.find((table) => table.id === "expense_card_private_details")!.columns
        .map((column) => column.key)
        .filter((key) => key !== "cardName"),
    };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 3 }));
    expect(plan.safeStringCapacityIncreases).toEqual([
      { tableId: "expenses", columnKey: "name", fromSize: 64, toSize: EXPENSE_NAME_STORAGE_CAPACITY, required: true },
      { tableId: "cards", columnKey: "name", fromSize: 64, toSize: CARD_NAME_STORAGE_CAPACITY, required: true },
    ]);
    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]).toMatchObject({
      tableExists: true,
      table: { id: "expense_card_private_details" },
      columns: [{ key: "cardName", kind: "string", size: 16_383, required: false }],
      indexes: [],
    });
    expect(plan.drifts).toEqual([]);
    expect(plan.provisioning).toEqual([]);
    expect(plan.errors).toEqual([]);
    expect(plan.createMetadataRow).toBe(true);
    expect(plan.metadataRowVersion).toBe(3);
  });

  it("is idempotent after the approved Schema V4 capacities and private column are present", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 7 }));
    expect(plan.safeStringCapacityIncreases).toEqual([]);
    expect(plan.tables).toEqual([]);
    expect(plan.drifts).toEqual([]);
    expect(plan.createMetadataRow).toBe(false);
  });

  it("refuses capacity decreases and unrelated capacity increases", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.households = { columnOverrides: { name: { size: HOUSEHOLD_NAME_STORAGE_CAPACITY + 1 } } };
    tables.profiles = { columnOverrides: { displayName: { size: 32 } } };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 2 }));
    expect(plan.safeStringCapacityIncreases).toEqual([]);
    expect(plan.drifts.join(" ")).toMatch(/capacity decreases are refused/);
    expect(plan.drifts.join(" ")).toMatch(/profiles\.displayName.*not explicitly approved/);
  });

  it("refuses column type drift without planning a mutation", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.households = { columnOverrides: { name: { kind: "longtext" } } };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 2 }));
    expect(plan.safeStringCapacityIncreases).toEqual([]);
    expect(plan.drifts.join(" ")).toMatch(/type.*longtext.*expected.*string.*refused/);
  });

  it("normalizes provider string columns with matching enum metadata as already correct", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 3 }));
    expect(plan.drifts).toEqual([]);
    expect(plan.tables).toEqual([]);
    expect(plan.existingCompleteTables).toEqual(TABLES.map((table) => table.id));
  });

  it("fails closed when a desired enum lacks provider enum metadata", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.memberships = { columnOverrides: { role: { format: undefined, elements: undefined } } };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 3 }));
    expect(plan.drifts.join(" ")).toMatch(/memberships\.role.*does not identify.*enum.*refused/);
  });

  it.each([
    ["different", ["leader", "owner"]],
    ["missing", ["leader"]],
    ["extra", ["leader", "member", "owner"]],
  ])("fails closed for %s provider enum elements", async (_case, elements) => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.memberships = { columnOverrides: { role: { elements } } };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 3 }));
    expect(plan.drifts.join(" ")).toMatch(/memberships\.role.*elements do not exactly match.*refused/);
  });

  it("fails closed for a different provider enum base type or format", async () => {
    const tables = Object.fromEntries(TABLES.map((table) => [table.id, {}]));
    tables.memberships = { columnOverrides: {
      role: { kind: "integer" },
      status: { format: "text" },
    } };
    const plan = await planSchemaApplication(readerFrom({ database: true, bucket: true, fn: true, tables, schemaVersion: 3 }));
    expect(plan.drifts.join(" ")).toMatch(/memberships\.role.*does not identify.*enum.*refused/);
    expect(plan.drifts.join(" ")).toMatch(/memberships\.status.*does not identify.*enum.*refused/);
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
