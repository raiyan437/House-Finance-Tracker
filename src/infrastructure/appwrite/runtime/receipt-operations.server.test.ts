import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { TablesDB } from "node-appwrite";
import { userId } from "@/domain/shared/identifiers";
import { createInMemoryTablesDB, InMemoryTablesReader } from "../reads/in-memory-tables-reader.helper";
import { guardRowId, membershipRowId, receiptMetadataRowId, receiptReservationRowId } from "../ids";
import { ReceiptOperations } from "./receipt-operations.server";
import type { ReceiptStorageFile, ReceiptStoragePort } from "./receipt-storage.server";

const NOW = "2026-08-27T08:00:00.000Z";
const HOUSEHOLD = "h_house1";
const EXPENSE = "e_expense1";
const CREATOR = userId("u_creator");
const MEMBER = userId("u_member");
const LEADER = userId("u_leader");

class MemoryReceiptStorage implements ReceiptStoragePort {
  readonly files = new Map<string, { bytes: Uint8Array; name: string; createdAt: string }>();
  createCount = 0;

  async create(fileId: string, bytes: Uint8Array, filename: string): Promise<ReceiptStorageFile> {
    if (this.files.has(fileId)) throw new Error("duplicate file");
    this.createCount += 1;
    this.files.set(fileId, { bytes: bytes.slice(), name: filename, createdAt: NOW });
    return { id: fileId, sizeBytes: bytes.byteLength, mimeType: "image/png", createdAt: NOW };
  }
  async get(fileId: string): Promise<ReceiptStorageFile | undefined> {
    const file = this.files.get(fileId);
    return file ? { id: fileId, sizeBytes: file.bytes.byteLength, mimeType: "image/png", createdAt: file.createdAt } : undefined;
  }
  async read(fileId: string): Promise<Uint8Array | undefined> {
    return this.files.get(fileId)?.bytes.slice();
  }
  async remove(fileId: string): Promise<"deleted" | "missing"> {
    return this.files.delete(fileId) ? "deleted" : "missing";
  }
  async list(): Promise<readonly ReceiptStorageFile[]> {
    return [...this.files].map(([id, file]) => ({ id, sizeBytes: file.bytes.byteLength, mimeType: "image/png", createdAt: file.createdAt }));
  }
}

function membership(id: string, role: "leader" | "member" = "member") {
  return { $id: membershipRowId(HOUSEHOLD, id), householdId: HOUSEHOLD, userId: id, role, status: "active", joinedAt: NOW, leftAt: null, statusChangedAt: NOW, version: 1 };
}

function expense() {
  return {
    $id: EXPENSE,
    householdId: HOUSEHOLD,
    expenseDate: "2026-08-27",
    amountPoisha: 100,
    payerId: String(CREATOR),
    splitMethod: "equal",
    name: "Groceries",
    paymentMethod: "cash",
    paymentRefJson: "{}",
    allocationsJson: JSON.stringify([{ participantId: String(CREATOR), sharePoisha: 100 }]),
    percentageEntriesJson: null,
    revision: 1,
    createdBy: String(CREATOR),
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    deletedByUserId: null,
  };
}

let reader: InMemoryTablesReader;
let tablesDB: TablesDB;
let storage: MemoryReceiptStorage;
let png: Uint8Array;

beforeEach(async () => {
  reader = new InMemoryTablesReader();
  tablesDB = createInMemoryTablesDB(reader).tablesDB as unknown as TablesDB;
  storage = new MemoryReceiptStorage();
  png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer());
  reader.seed("expenses", [expense()]);
  reader.seed("memberships", [membership(String(CREATOR)), membership(String(MEMBER)), membership(String(LEADER), "leader")]);
  reader.seed("receipt_metadata", []);
  reader.seed("receipt_reservations", []);
  reader.seed("command_outcomes", []);
  reader.seed("audit_events", []);
  reader.seed("coordination_guards", [{ $id: guardRowId(`financial:${HOUSEHOLD}`), logicalKey: `financial:${HOUSEHOLD}`, ownerValue: null, counter: 0, version: 0, createdAt: NOW }]);
});

function service(actor = CREATOR): ReceiptOperations {
  return new ReceiptOperations(tablesDB, storage, actor, () => NOW);
}

describe("trusted Receipt storage sagas", () => {
  it("uploads once, persists private metadata, and replays a lost response without duplication", async () => {
    const input = { expenseId: EXPENSE, commandId: "upload-1", mimeType: "image/png" as const, originalFilename: "private.png", bytes: png };
    const operations = service();
    const first = await operations.upload(input);
    const replay = await service().upload(input);

    expect(first).toEqual(replay);
    expect(first.visibility).toBe("private");
    expect(storage.createCount).toBe(1);
    expect(await reader.listRows("receipt_metadata")).toHaveLength(1);
    expect(await reader.listRows("command_outcomes")).toHaveLength(1);
    expect(operations.lastStagedOperations).toMatchObject({ reserve: 6, finalize: 5 });
  });

  it("recovers deterministic Storage success followed by metadata transaction failure", async () => {
    const input = { expenseId: EXPENSE, commandId: "upload-recover", mimeType: "image/png" as const, bytes: png };
    const metadataId = receiptMetadataRowId(String(CREATOR), input.commandId);
    reader.conflictOnCommit.add(`receipt_metadata/${metadataId}`);
    await expect(service().upload(input)).rejects.toMatchObject({ kind: "conflict" });
    expect(storage.createCount).toBe(1);
    expect(await reader.getRow("receipt_metadata", metadataId)).toBeUndefined();

    reader.conflictOnCommit.clear();
    await expect(service().upload(input)).resolves.toMatchObject({ receiptId: metadataId });
    expect(storage.createCount).toBe(1);
    expect(await reader.listRows("receipt_metadata")).toHaveLength(1);
  });

  it("does not finalize while maintenance owns an abandoned cleanup claim", async () => {
    const input = { expenseId: EXPENSE, commandId: "upload-cleanup-race", mimeType: "image/png" as const, bytes: png };
    const metadataId = receiptMetadataRowId(String(CREATOR), input.commandId);
    reader.conflictOnCommit.add(`receipt_metadata/${metadataId}`);
    await expect(service().upload(input)).rejects.toMatchObject({ kind: "conflict" });
    reader.conflictOnCommit.clear();
    const reservationId = receiptReservationRowId(String(CREATOR), input.commandId);
    reader.stageUpdateRow("hft", "receipt_reservations", reservationId, { state: "abandoned" });

    await expect(service().upload(input)).rejects.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
    expect(await reader.getRow("receipt_metadata", metadataId)).toBeUndefined();
  });

  it("rejects changed-content command reuse without replacing the stored file", async () => {
    const input = { expenseId: EXPENSE, commandId: "upload-bound", mimeType: "image/png" as const, bytes: png };
    await service().upload(input);
    const changed = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 3, background: "#654321" } }).png().toBuffer());
    await expect(service().upload({ ...input, bytes: changed })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(storage.createCount).toBe(1);
  });

  it("allows only creator/historical uploader reads and gives Leader no extra authority", async () => {
    const uploaded = await service().upload({ expenseId: EXPENSE, commandId: "upload-private", mimeType: "image/png", bytes: png });
    await expect(service().read(String(uploaded.receiptId))).resolves.toMatchObject({ mimeType: "image/png", sizeBytes: png.byteLength });
    await expect(service(MEMBER).read(String(uploaded.receiptId))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service(LEADER).read(String(uploaded.receiptId))).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = (await reader.getRow("receipt_metadata", String(uploaded.receiptId)))!;
    reader.stageUpdateRow("hft", "receipt_metadata", String(uploaded.receiptId), { uploaderId: String(MEMBER) });
    expect(row).toBeDefined();
    await expect(service(MEMBER).read(String(uploaded.receiptId))).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it("removes content once, retains terminal metadata, and replays success", async () => {
    const uploaded = await service().upload({ expenseId: EXPENSE, commandId: "upload-remove", mimeType: "image/png", bytes: png });
    const input = { receiptId: String(uploaded.receiptId), commandId: "remove-1" };
    const operations = service();
    await expect(operations.remove(input)).resolves.toEqual({ receiptId: String(uploaded.receiptId), status: "user-deleted" });
    await expect(service().remove(input)).resolves.toEqual({ receiptId: String(uploaded.receiptId), status: "user-deleted" });
    const metadata = await reader.getRow("receipt_metadata", String(uploaded.receiptId));
    expect(metadata).toMatchObject({ contentState: "user-deleted", contentRemovedByUserId: String(CREATOR) });
    expect(storage.files).toHaveLength(0);
    expect(operations.lastStagedOperations.remove).toBe(7);
    await expect(service().read(String(uploaded.receiptId))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces three available-or-reserved Receipt slots", async () => {
    for (let index = 0; index < 3; index += 1) {
      await service().upload({ expenseId: EXPENSE, commandId: `slot-${index}`, mimeType: "image/png", bytes: png });
    }
    await expect(service().upload({ expenseId: EXPENSE, commandId: "slot-4", mimeType: "image/png", bytes: png }))
      .rejects.toMatchObject({ code: "RECEIPT_COUNT_LIMIT_EXCEEDED" });
  });
});
