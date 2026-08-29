import { describe, expect, it } from "vitest";
import {
  BUCKET,
  CARD_NAME_STORAGE_CAPACITY,
  EXPENSE_NAME_STORAGE_CAPACITY,
  HOUSEHOLD_NAME_STORAGE_CAPACITY,
  MAINTENANCE_FUNCTION,
  RECEIPT_MAX_FILE_BYTES,
  SCHEMA_VERSION,
  TABLES,
  tableById,
  type TableDefinition,
} from "./definitions";

function columns(table: TableDefinition): Map<string, string> {
  return new Map(table.columns.map((column) => [column.key, column.kind]));
}

describe("Appwrite schema definitions (approved Rev 4 + corrections)", () => {
  it("stores every exact monetary value in a bigint column", () => {
    expect(columns(tableById("expenses")!).get("amountPoisha")).toBe("bigint");
    const settlements = columns(tableById("settlements")!);
    expect(settlements.get("amountPoisha")).toBe("bigint");
    expect(settlements.get("originalAmountPoisha")).toBe("bigint");
    for (const table of TABLES) {
      for (const column of table.columns) {
        if (column.key.toLowerCase().includes("poisha")) expect(column.kind).toBe("bigint");
      }
    }
  });

  it("keeps private Card associations out of the general Expense row", () => {
    const expenseColumns = [...columns(tableById("expenses")!).keys()];
    expect(expenseColumns.some((key) => key.toLowerCase().includes("card"))).toBe(false);
    expect(tableById("expense_card_private_details")).toBeDefined();
    expect(tableById("expenses")!.columns.map((c) => c.key)).not.toContain("cardAssocToken");
  });

  it("does not persist derived financial-lock state", () => {
    for (const table of TABLES) {
      expect(table.columns.map((column) => column.key)).not.toContain("financialLockedAt");
      expect(table.columns.map((column) => column.key)).not.toContain("lockedAt");
    }
  });

  it("does not persist balances, recommendations, or analytics aggregates", () => {
    const forbidden = ["balance", "recommendation_cache", "snapshot_total", "monthly_total"];
    for (const table of TABLES) {
      for (const column of table.columns) {
        expect(forbidden.some((fragment) => column.key.includes(fragment))).toBe(false);
      }
    }
  });

  it("defines the coordination guard and reservation infrastructure tables", () => {
    const ids = TABLES.map((table) => table.id);
    for (const id of ["coordination_guards", "receipt_reservations", "command_outcomes", "schema_metadata"]) {
      expect(ids).toContain(id);
    }
  });

  it("keeps the receipts bucket private with frozen file limits", () => {
    expect(BUCKET.fileSecurity).toBe(true);
    expect(BUCKET.maxFileSizeBytes).toBe(RECEIPT_MAX_FILE_BYTES);
    expect(RECEIPT_MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it("defines exactly one scheduled maintenance function skeleton within Free-plan limits", () => {
    expect(MAINTENANCE_FUNCTION.schedule).toBe("0 0 * * *");
    expect(MAINTENANCE_FUNCTION.timeoutSeconds).toBeLessThanOrEqual(900);
    expect(MAINTENANCE_FUNCTION.execute).toEqual([]);
  });

  it("exposes a stable schema version and lookup helper", () => {
    expect(SCHEMA_VERSION).toBe(4);
    expect(TABLES.every((table) => table.id.length <= 36 && /^[a-z_]+$/.test(table.id))).toBe(true);
    expect(tableById("missing")).toBeUndefined();
  });

  it("treats Household-name length as provider capacity rather than a product maximum", () => {
    const name = tableById("households")!.columns.find((column) => column.key === "name");
    expect(name).toEqual(expect.objectContaining({
      kind: "string",
      size: HOUSEHOLD_NAME_STORAGE_CAPACITY,
      required: true,
    }));
    expect(HOUSEHOLD_NAME_STORAGE_CAPACITY).toBe(16_383);
  });

  it("defines only the approved R3 name capacities and optional private snapshot name", () => {
    const cardName = tableById("cards")!.columns.find((column) => column.key === "name");
    const expenseName = tableById("expenses")!.columns.find((column) => column.key === "name");
    const snapshotName = tableById("expense_card_private_details")!.columns.find((column) => column.key === "cardName");
    expect(cardName).toEqual(expect.objectContaining({ kind: "string", size: CARD_NAME_STORAGE_CAPACITY, required: true }));
    expect(expenseName).toEqual(expect.objectContaining({ kind: "string", size: EXPENSE_NAME_STORAGE_CAPACITY, required: true }));
    expect(snapshotName).toEqual(expect.objectContaining({ kind: "string", size: CARD_NAME_STORAGE_CAPACITY, required: false }));
    expect(CARD_NAME_STORAGE_CAPACITY).toBe(16_383);
    expect(EXPENSE_NAME_STORAGE_CAPACITY).toBe(16_383);
    expect(tableById("expense_card_private_details")!.indexes.flatMap((index) => index.columns)).not.toContain("cardName");
  });
});
