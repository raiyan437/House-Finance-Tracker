import { describe, expect, it } from "vitest";
import type { TablesDB } from "node-appwrite";
import { createInMemoryTablesDB, InMemoryTablesReader } from "./reads/in-memory-tables-reader.helper";
import { guardRowId } from "./ids";
import { runMaintenance } from "../../../functions/maintenance/src/main.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");

class MaintenanceStorage {
  readonly files = new Map<string, { $id: string; $createdAt: string }>();
  beforeDelete?: (fileId: string) => Promise<void>;
  failNextDelete = false;

  async deleteFile(input: { fileId: string }) {
    await this.beforeDelete?.(input.fileId);
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("temporary Storage failure");
    }
    const deleted = this.files.delete(input.fileId);
    if (!deleted) throw Object.assign(new Error("missing"), { code: 404 });
  }

  async listFiles() {
    return { files: [...this.files.values()] };
  }
}

function guard(logicalKey: string, counter: number) {
  return { $id: guardRowId(logicalKey), logicalKey, ownerValue: null, counter, version: 1, createdAt: "2026-08-01T00:00:00.000Z" };
}

function receipt(id: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    $id: id,
    storageFileId: `f_${id.slice(2)}`,
    uploaderId: "u_creator",
    householdId: "h_house",
    expenseId: "e_expense",
    mimeType: "image/png",
    sizeBytes: 100,
    contentState: "available",
    contentRemovedAt: null,
    contentRemovedByUserId: null,
    originalFilename: null,
    checksum: "a".repeat(64),
    createdAt,
    ...overrides,
  };
}

function instrumentedTables(reader: InMemoryTablesReader): { tables: TablesDB; committedOperationCounts: number[] } {
  const base = createInMemoryTablesDB(reader).tablesDB as unknown as Record<string, (...args: never[]) => unknown>;
  const counts = new Map<string, number>();
  const committedOperationCounts: number[] = [];
  const wrapped = { ...base } as Record<string, (...args: never[]) => unknown>;
  for (const method of ["createRow", "updateRow", "deleteRow"]) {
    wrapped[method] = (async (input: { transactionId?: string }) => {
      if (input.transactionId) counts.set(input.transactionId, (counts.get(input.transactionId) ?? 0) + 1);
      return base[method]!(input as never);
    }) as never;
  }
  wrapped.updateTransaction = (async (input: { transactionId: string; commit?: boolean }) => {
    if (input.commit) committedOperationCounts.push(counts.get(input.transactionId) ?? 0);
    return base.updateTransaction!(input as never);
  }) as never;
  return { tables: wrapped as unknown as TablesDB, committedOperationCounts };
}

function seedBase(reader: InMemoryTablesReader) {
  reader.seed("receipt_metadata", []);
  reader.seed("receipt_reservations", []);
  reader.seed("coordination_guards", []);
}

describe("bounded Appwrite maintenance worker", () => {
  it("expires only content strictly before the Dhaka cutoff and never fabricates an actor", async () => {
    const reader = new InMemoryTablesReader();
    seedBase(reader);
    reader.seed("receipt_metadata", [
      receipt("r_old", "2026-05-31T17:59:59.999Z"),
      receipt("r_equal", "2026-05-31T18:00:00.000Z"),
    ]);
    reader.seed("coordination_guards", [
      guard("receipt-count:e_expense", 2),
      guard("receipt-uploader-bytes:u_creator", 200),
      guard("receipt-project-bytes", 200),
    ]);
    const storage = new MaintenanceStorage();
    storage.files.set("f_old", { $id: "f_old", $createdAt: "2026-05-31T17:59:59.999Z" });
    storage.files.set("f_equal", { $id: "f_equal", $createdAt: "2026-05-31T18:00:00.000Z" });
    const instrumented = instrumentedTables(reader);

    await expect(runMaintenance({ tables: instrumented.tables, storage, now: NOW })).resolves.toMatchObject({ status: "completed" });
    expect(await reader.getRow("receipt_metadata", "r_old")).toMatchObject({ contentState: "retention-expired", contentRemovedAt: NOW.toISOString(), contentRemovedByUserId: null });
    expect(await reader.getRow("receipt_metadata", "r_equal")).toMatchObject({ contentState: "available" });
    expect(storage.files.has("f_old")).toBe(false);
    expect(storage.files.has("f_equal")).toBe(true);
    expect(Math.max(...instrumented.committedOperationCounts)).toBeLessThanOrEqual(25);
  });

  it("claims a stale reservation before deleting its deterministic upload file", async () => {
    const reader = new InMemoryTablesReader();
    seedBase(reader);
    reader.seed("receipt_reservations", [{
      $id: "q_saga", uploaderId: "u_creator", expenseId: "e_expense", bytes: 50,
      state: "reserved", expiresAt: "2026-08-27T10:00:00.000Z", createdAt: "2026-08-27T09:00:00.000Z",
    }]);
    const storage = new MaintenanceStorage();
    storage.files.set("f_saga", { $id: "f_saga", $createdAt: "2026-08-27T09:30:00.000Z" });
    storage.beforeDelete = async () => {
      expect(await reader.getRow("receipt_reservations", "q_saga")).toMatchObject({ state: "abandoned" });
    };
    const { tables } = instrumentedTables(reader);

    await runMaintenance({ tables, storage, now: NOW });
    expect(storage.files.has("f_saga")).toBe(false);
    expect(await reader.getRow("receipt_reservations", "q_saga")).toMatchObject({ state: "released" });
  });

  it("resumes an abandoned cleanup claim after a temporary Storage failure", async () => {
    const reader = new InMemoryTablesReader();
    seedBase(reader);
    reader.seed("receipt_reservations", [{
      $id: "q_retry", uploaderId: "u_creator", expenseId: "e_expense", bytes: 50,
      state: "reserved", expiresAt: "2026-08-27T10:00:00.000Z", createdAt: "2026-08-27T09:00:00.000Z",
    }]);
    const storage = new MaintenanceStorage();
    storage.files.set("f_retry", { $id: "f_retry", $createdAt: "2026-08-27T09:30:00.000Z" });
    storage.failNextDelete = true;
    const { tables } = instrumentedTables(reader);

    await expect(runMaintenance({ tables, storage, now: NOW })).rejects.toThrow("temporary Storage failure");
    expect(await reader.getRow("receipt_reservations", "q_retry")).toMatchObject({ state: "abandoned" });
    expect(storage.files.has("f_retry")).toBe(true);

    await expect(runMaintenance({ tables, storage, now: NOW })).resolves.toMatchObject({ status: "completed" });
    expect(await reader.getRow("receipt_reservations", "q_retry")).toMatchObject({ state: "released" });
    expect(storage.files.has("f_retry")).toBe(false);
  });

  it("deletes only untracked files older than the 24-hour grace and repairs quota counters", async () => {
    const reader = new InMemoryTablesReader();
    seedBase(reader);
    reader.seed("receipt_metadata", [receipt("r_kept", "2026-08-20T00:00:00.000Z")]);
    reader.seed("coordination_guards", [
      guard("receipt-count:e_expense", 999),
      guard("receipt-uploader-bytes:u_creator", 999),
      guard("receipt-project-bytes", 999),
    ]);
    const storage = new MaintenanceStorage();
    storage.files.set("f_kept", { $id: "f_kept", $createdAt: "2026-08-20T00:00:00.000Z" });
    storage.files.set("foreign_old", { $id: "foreign_old", $createdAt: "2026-08-26T11:59:59.999Z" });
    storage.files.set("foreign_new", { $id: "foreign_new", $createdAt: "2026-08-26T12:00:00.001Z" });
    const { tables } = instrumentedTables(reader);

    await runMaintenance({ tables, storage, now: NOW });
    expect(storage.files.has("foreign_old")).toBe(false);
    expect(storage.files.has("foreign_new")).toBe(true);
    expect(await reader.getRow("coordination_guards", guardRowId("receipt-count:e_expense"))).toMatchObject({ counter: 1 });
    expect(await reader.getRow("coordination_guards", guardRowId("receipt-uploader-bytes:u_creator"))).toMatchObject({ counter: 100 });
    expect(await reader.getRow("coordination_guards", guardRowId("receipt-project-bytes"))).toMatchObject({ counter: 100 });
  });

  it("skips overlapping executions while a live lease exists", async () => {
    const reader = new InMemoryTablesReader();
    seedBase(reader);
    reader.seed("coordination_guards", [{ ...guard("maintenance:lease", NOW.getTime() + 60_000), ownerValue: "other-run" }]);
    const { tables } = instrumentedTables(reader);
    await expect(runMaintenance({ tables, storage: new MaintenanceStorage(), now: NOW })).resolves.toEqual({ status: "skipped-overlap" });
  });
});
