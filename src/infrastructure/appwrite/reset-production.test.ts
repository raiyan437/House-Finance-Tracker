import { describe, expect, it, vi } from "vitest";
import {
  EXPECTED_SCHEMA_VERSION,
  PRODUCTION_PROJECT_ID,
  RESET_CONFIRMATION,
  RESET_TABLE_ORDER,
  assertBackupCoversInventory,
  assertExpectedProductionTarget,
  classifyAuthUsers,
  deleteProductionTestData,
  parseResetArguments,
  type ResetOperations,
  type ResetTableId,
} from "../../../scripts/appwrite-reset-production-core";

describe("production reset safety", () => {
  it("is dry-run by default and requires every destructive confirmation", () => {
    expect(parseResetArguments([])).toEqual({ execute: false });
    expect(() => parseResetArguments(["--yes"])).toThrow("requires --yes");
    expect(() => parseResetArguments(["--yes", "--confirm", RESET_CONFIRMATION])).toThrow("--backup");
    expect(parseResetArguments(["--yes", "--confirm", RESET_CONFIRMATION, "--backup", "C:/backup"])).toEqual({
      execute: true,
      backupDirectory: "C:/backup",
    });
    expect(() => parseResetArguments(["--project-id", "other"])).toThrow("refuses target overrides");
  });

  it("pins the exact production project, endpoint, schema, and three-entry allowlist", () => {
    expect(() => assertExpectedProductionTarget({
      endpoint: "https://sgp.cloud.appwrite.io/v1",
      projectId: PRODUCTION_PROJECT_ID,
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      approvedEmailCount: 3,
    })).not.toThrow();
    expect(() => assertExpectedProductionTarget({
      endpoint: "https://sgp.cloud.appwrite.io/v1",
      projectId: "other",
      schemaVersion: EXPECTED_SCHEMA_VERSION,
      approvedEmailCount: 3,
    })).toThrow("known House Finance Tracker production project");
    expect(() => assertExpectedProductionTarget({
      endpoint: "https://sgp.cloud.appwrite.io/v1",
      projectId: PRODUCTION_PROJECT_ID,
      schemaVersion: 4,
      approvedEmailCount: 3,
    })).toThrow("schema version must remain 5");
  });

  it("classifies users without exposing ids or email addresses", () => {
    const users = classifyAuthUsers([
      { $id: "approved-id", email: " Person@Example.com " },
      { $id: "anonymous-id", email: "" },
      { $id: "unexpected-id", email: "outsider@example.net" },
    ], new Set(["person@example.com"]));
    expect(users.map((user) => user.classification)).toEqual([
      "approved-email-test-user",
      "anonymous-test-artifact",
      "unexpected-user",
    ]);
    expect(JSON.stringify(users)).not.toContain("Person@Example.com");
    expect(JSON.stringify(users)).not.toContain("approved-id");
  });

  it("allows a verified pre-reset backup to cover resumable partial progress", () => {
    expect(() => assertBackupCoversInventory(
      { profiles: 3, schema_metadata: 1 },
      3,
      { profiles: 2, schema_metadata: 1 },
      0,
    )).not.toThrow();
    expect(() => assertBackupCoversInventory(
      { profiles: 2, schema_metadata: 1 },
      3,
      { profiles: 3, schema_metadata: 1 },
      0,
    )).toThrow("does not cover current profiles rows");
    expect(() => assertBackupCoversInventory(
      { profiles: 3, schema_metadata: 1 },
      2,
      { profiles: 3, schema_metadata: 1 },
      3,
    )).toThrow("does not cover current Receipt files");
  });

  it("deletes files, rows in dependency order, then users, and is resumable", async () => {
    const events: string[] = [];
    const files = ["file-1"];
    const rows = Object.fromEntries(RESET_TABLE_ORDER.map((tableId) => [tableId, [`${tableId}-1`]])) as Record<ResetTableId, string[]>;
    const users = ["user-1"];
    const operations: ResetOperations = {
      listStorageFileIds: async () => [...files],
      deleteStorageFile: async (id) => { events.push(`file:${id}`); files.splice(files.indexOf(id), 1); return "deleted"; },
      listRowIds: async (tableId) => [...rows[tableId]],
      deleteRow: async (tableId, id) => { events.push(`row:${tableId}:${id}`); rows[tableId].splice(rows[tableId].indexOf(id), 1); return "deleted"; },
      listAuthUserIds: async () => [...users],
      deleteAuthUser: async (id) => { events.push(`user:${id}`); users.splice(users.indexOf(id), 1); return "deleted"; },
    };
    const result = await deleteProductionTestData(operations);
    expect(result.storageFiles.deleted).toBe(1);
    expect(result.authUsers.deleted).toBe(1);
    expect(events).toEqual([
      "file:file-1",
      ...RESET_TABLE_ORDER.map((tableId) => `row:${tableId}:${tableId}-1`),
      "user:user-1",
    ]);
    expect(await deleteProductionTestData(operations)).toEqual({
      storageFiles: { deleted: 0, alreadyMissing: 0 },
      tables: Object.fromEntries(RESET_TABLE_ORDER.map((tableId) => [tableId, { deleted: 0, alreadyMissing: 0 }])),
      authUsers: { deleted: 0, alreadyMissing: 0 },
    });
    expect(vi.isMockFunction(operations.deleteRow)).toBe(false);
  });
});
