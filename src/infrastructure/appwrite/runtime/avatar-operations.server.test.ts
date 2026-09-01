import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { TablesDB } from "node-appwrite";
import { userId } from "@/domain/shared/identifiers";
import { avatarStorageFileId } from "../ids";
import { createInMemoryTablesDB, InMemoryTablesReader } from "../reads/in-memory-tables-reader.helper";
import type { PrivateImageStoragePort, PrivateStorageFile } from "./receipt-storage.server";
import { AvatarOperations } from "./avatar-operations.server";

const OWNER = userId("u_owner");
const MEMBER = userId("u_member");
const FOREIGN = userId("u_foreign");
const NOW = "2026-09-01T10:00:00.000Z";
let PNG: Uint8Array;
let JPEG: Uint8Array;

class AvatarStorage implements PrivateImageStoragePort {
  readonly files = new Map<string, { bytes: Uint8Array; file: PrivateStorageFile }>();
  readonly failRemove = new Set<string>();

  async create(fileId: string, bytes: Uint8Array, filename: string): Promise<PrivateStorageFile> {
    if (this.files.has(fileId)) throw new Error("duplicate");
    const mimeType = filename.endsWith(".jpg") ? "image/jpeg" : filename.endsWith(".webp") ? "image/webp" : "image/png";
    const file = { id: fileId, sizeBytes: bytes.byteLength, mimeType, createdAt: NOW };
    this.files.set(fileId, { bytes: bytes.slice(), file });
    return file;
  }
  async get(fileId: string) { return this.files.get(fileId)?.file; }
  async read(fileId: string) { return this.files.get(fileId)?.bytes.slice(); }
  async remove(fileId: string): Promise<"deleted" | "missing"> {
    if (this.failRemove.has(fileId)) throw new Error("delete failed");
    return this.files.delete(fileId) ? "deleted" : "missing";
  }
  async list() { return [...this.files.values()].map((entry) => entry.file); }
}

function membership(id: string, householdId: string, memberId: string, status = "active") {
  return { $id: id, householdId, userId: memberId, role: memberId === String(OWNER) ? "leader" : "member", status, joinedAt: NOW, leftAt: status === "former" ? NOW : null, statusChangedAt: NOW, version: 1 };
}

let reader: InMemoryTablesReader;
let storage: AvatarStorage;

beforeAll(async () => {
  PNG = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 3, background: "#336699" } }).png().toBuffer());
  JPEG = new Uint8Array(await sharp({ create: { width: 2, height: 3, channels: 3, background: "#993366" } }).jpeg().toBuffer());
});

beforeEach(() => {
  reader = new InMemoryTablesReader();
  reader.seed("profiles", [
    { $id: String(OWNER), displayName: "Owner", avatarFileId: null, avatarUpdatedAt: null, version: 1, createdAt: NOW, updatedAt: NOW },
    { $id: String(MEMBER), displayName: "Member", avatarFileId: null, avatarUpdatedAt: null, version: 1, createdAt: NOW, updatedAt: NOW },
    { $id: String(FOREIGN), displayName: "Foreign", avatarFileId: null, avatarUpdatedAt: null, version: 1, createdAt: NOW, updatedAt: NOW },
  ]);
  reader.seed("memberships", [
    membership("m_owner", "h_shared", String(OWNER)),
    membership("m_member", "h_shared", String(MEMBER)),
    membership("m_foreign", "h_other", String(FOREIGN)),
  ]);
  reader.seed("command_outcomes", []);
  storage = new AvatarStorage();
});

function operations(actor = OWNER) {
  return new AvatarOperations(createInMemoryTablesDB(reader).tablesDB as unknown as TablesDB, storage, actor, () => NOW);
}

describe("private avatar Storage saga", () => {
  it("uploads once, replays a lost response, and rejects changed content under the same command", async () => {
    const service = operations();
    const first = await service.replace({ commandId: "avatar-one", expectedProfileVersion: 1, mimeType: "image/png", bytes: PNG });
    const replay = await service.replace({ commandId: "avatar-one", expectedProfileVersion: 1, mimeType: "image/png", bytes: PNG });
    expect(replay).toEqual(first);
    expect(first.profileVersion).toBe(2);
    expect(storage.files.size).toBe(1);
    expect(await reader.getRow("profiles", String(OWNER))).toMatchObject({
      avatarFileId: avatarStorageFileId(String(OWNER), "avatar-one"), version: 2,
    });
    await expect(service.replace({ commandId: "avatar-one", expectedProfileVersion: 1, mimeType: "image/jpeg", bytes: JPEG }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(storage.files.size).toBe(1);
  });

  it("makes replacement authoritative, removes the old file, and tolerates old-file deletion failure", async () => {
    const service = operations();
    await service.replace({ commandId: "avatar-first", expectedProfileVersion: 1, mimeType: "image/png", bytes: PNG });
    const oldId = avatarStorageFileId(String(OWNER), "avatar-first");
    await service.replace({ commandId: "avatar-second", expectedProfileVersion: 2, mimeType: "image/jpeg", bytes: JPEG });
    const secondId = avatarStorageFileId(String(OWNER), "avatar-second");
    expect(storage.files.has(oldId)).toBe(false);
    expect(await reader.getRow("profiles", String(OWNER))).toMatchObject({ avatarFileId: secondId, version: 3 });

    storage.failRemove.add(secondId);
    await service.replace({ commandId: "avatar-third", expectedProfileVersion: 3, mimeType: "image/png", bytes: PNG });
    expect(await reader.getRow("profiles", String(OWNER))).toMatchObject({ avatarFileId: avatarStorageFileId(String(OWNER), "avatar-third"), version: 4 });
    expect(storage.files.has(secondId)).toBe(true);
  });

  it("cleans the new upload when the Profile pointer update loses OCC", async () => {
    const service = operations();
    await service.replace({ commandId: "winner", expectedProfileVersion: 1, mimeType: "image/png", bytes: PNG });
    await expect(service.replace({ commandId: "loser", expectedProfileVersion: 1, mimeType: "image/jpeg", bytes: JPEG }))
      .rejects.toMatchObject({ code: "PROFILE_VERSION_CONFLICT" });
    expect(storage.files.has(avatarStorageFileId(String(OWNER), "loser"))).toBe(false);
    expect(storage.files.size).toBe(1);
  });

  it("allows exactly one authoritative winner during simultaneous replacement", async () => {
    const [left, right] = await Promise.allSettled([
      operations().replace({ commandId: "race-left", expectedProfileVersion: 1, mimeType: "image/png", bytes: PNG }),
      operations().replace({ commandId: "race-right", expectedProfileVersion: 1, mimeType: "image/jpeg", bytes: JPEG }),
    ]);

    expect([left.status, right.status].filter((status) => status === "fulfilled")).toHaveLength(1);
    expect([left.status, right.status].filter((status) => status === "rejected")).toHaveLength(1);
    const profile = await reader.getRow("profiles", String(OWNER));
    expect(profile).toMatchObject({ version: 2 });
    expect(storage.files.has(String(profile?.avatarFileId))).toBe(true);
    expect(storage.files.size).toBe(1);
  });

  it("allows self and active Household reads while denying unrelated, former, and guessed identities", async () => {
    await operations().replace({ commandId: "readable", expectedProfileVersion: 1, mimeType: "image/png", bytes: PNG });
    await expect(operations().read(String(OWNER))).resolves.toMatchObject({ mimeType: "image/png", sizeBytes: PNG.byteLength });
    await expect(operations(MEMBER).read(String(OWNER))).resolves.toMatchObject({ mimeType: "image/png" });
    await expect(operations(FOREIGN).read(String(OWNER))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(operations(MEMBER).read("avatar_guessed-storage-id")).rejects.toMatchObject({ code: "NOT_FOUND" });

    reader.seed("memberships", [
      membership("m_owner", "h_shared", String(OWNER)),
      membership("m_member", "h_shared", String(MEMBER), "former"),
      membership("m_foreign", "h_other", String(FOREIGN)),
    ]);
    await expect(operations(MEMBER).read(String(OWNER))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("never lets a leader mutate another member because replacement has no target-user input", async () => {
    const memberService = operations(MEMBER);
    await memberService.replace({ commandId: "member-own", expectedProfileVersion: 1, mimeType: "image/png", bytes: PNG });
    expect(await reader.getRow("profiles", String(MEMBER))).toMatchObject({ version: 2, avatarFileId: avatarStorageFileId(String(MEMBER), "member-own") });
    expect(await reader.getRow("profiles", String(OWNER))).toMatchObject({ version: 1, avatarFileId: null });
  });
});
