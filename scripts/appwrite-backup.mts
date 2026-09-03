/**
 * Manual R4 backup: exports database rows and every currently retained Receipt
 * binary into one self-verifying directory outside the repository.
 *
 * Usage:
 *   npx tsx scripts/appwrite-backup.mts
 *   npx tsx scripts/appwrite-backup.mts --verify <backup-directory>
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Client, Query, Storage, TablesDB } from "node-appwrite";
import sharp from "sharp";
import { loadAppwriteCliEnv } from "./appwrite-cli-env";
import { resolveVerifiedReceiptBinaryPath } from "./receipt-backup-path";
import { resolveVerifiedAvatarBinaryPath } from "./avatar-backup-path";
import { assertAvatarBackupCoverage } from "./avatar-backup-integrity";

const DATABASE_ID = "hft";
const BUCKET_ID = "receipts";
const MAX_RECEIPT_DECODED_PIXELS = 268_402_689;
const MAX_AVATAR_DECODED_PIXELS = 40_000_000;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const TABLE_IDS = [
  "profiles", "households", "memberships", "join_requests", "expenses",
  "expense_comments", "expense_card_private_details", "settlements", "cards", "receipt_metadata",
  "audit_events", "command_outcomes", "coordination_guards",
  "receipt_reservations", "schema_metadata",
] as const;

interface ReceiptManifestEntry {
  readonly receiptId: string;
  readonly relativePath: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface BackupManifest {
  readonly formatVersion: 3;
  readonly createdAt: string;
  readonly projectId: string;
  readonly scope: string;
  readonly rowsSha256: string;
  readonly tableCounts: Readonly<Record<string, number>>;
  readonly receipts: readonly ReceiptManifestEntry[];
  readonly avatars: readonly AvatarManifestEntry[];
}

interface AvatarManifestEntry {
  readonly userId: string;
  readonly relativePath: string;
  readonly mimeType: ReceiptManifestEntry["mimeType"];
  readonly sizeBytes: number;
  readonly sha256: string;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function expectedSharpFormat(mimeType: ReceiptManifestEntry["mimeType"]): string {
  return mimeType === "image/jpeg" ? "jpeg" : mimeType.slice("image/".length);
}

async function verifyDecodedImage(bytes: Uint8Array, mimeType: ReceiptManifestEntry["mimeType"], maxPixels = MAX_RECEIPT_DECODED_PIXELS): Promise<void> {
  const decoder = sharp(bytes, { failOn: "error", sequentialRead: true, limitInputPixels: maxPixels });
  const metadata = await decoder.metadata();
  if (metadata.format !== expectedSharpFormat(mimeType) || !metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) {
    throw new Error(`Backup binary is not a valid ${mimeType} image.`);
  }
  await decoder.stats();
}

async function exportTable(tables: TablesDB, tableId: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const queries = [Query.orderAsc("$id"), Query.limit(100)];
    const page = await tables.listRows({ databaseId: DATABASE_ID, tableId, queries: cursor ? [...queries, Query.cursorAfter(cursor)] : queries });
    rows.push(...page.rows as Array<Record<string, unknown>>);
    cursor = page.rows.length === 100 ? page.rows.at(-1)?.$id : undefined;
  } while (cursor);
  return rows;
}

async function listStorageFiles(storage: Storage) {
  const files = [];
  let cursor: string | undefined;
  do {
    const queries = [Query.orderAsc("$id"), Query.limit(100)];
    const page = await storage.listFiles({ bucketId: BUCKET_ID, queries: cursor ? [...queries, Query.cursorAfter(cursor)] : queries });
    files.push(...page.files);
    cursor = page.files.length === 100 ? page.files.at(-1)?.$id : undefined;
  } while (cursor);
  return files;
}

async function verifyBackup(directory: string): Promise<{ manifest: BackupManifest; bytes: number }> {
  const root = resolve(directory);
  const manifestRaw = readFileSync(join(root, "manifest.json"), "utf8");
  const manifestDigest = readFileSync(join(root, "manifest.sha256"), "utf8").trim();
  if (sha256(manifestRaw) !== manifestDigest) throw new Error("Backup manifest checksum mismatch.");
  const manifest = JSON.parse(manifestRaw) as BackupManifest;
  if (manifest.formatVersion !== 3) throw new Error("Unsupported backup format.");
  const rowsRaw = readFileSync(join(root, "rows.json"), "utf8");
  if (sha256(rowsRaw) !== manifest.rowsSha256) throw new Error("Backup rows checksum mismatch.");
  const rows = JSON.parse(rowsRaw) as { tables: Record<string, { count: number; rows: Array<Record<string, unknown>> }> };
  for (const [tableId, count] of Object.entries(manifest.tableCounts)) {
    if (rows.tables[tableId]?.count !== count || rows.tables[tableId]?.rows.length !== count) throw new Error(`Backup row count mismatch for ${tableId}.`);
  }
  const metadata = new Map((rows.tables.receipt_metadata?.rows ?? []).map((row) => [String(row.$id), row]));
  const seenReceipts = new Set<string>();
  let totalBytes = 0;
  for (const receipt of manifest.receipts) {
    if (seenReceipts.has(receipt.receiptId)) throw new Error(`Duplicate Receipt backup entry for ${receipt.receiptId}.`);
    seenReceipts.add(receipt.receiptId);
    const row = metadata.get(receipt.receiptId);
    if (!row || row.contentState !== "available" || row.mimeType !== receipt.mimeType || Number(row.sizeBytes) !== receipt.sizeBytes || row.checksum !== receipt.sha256) {
      throw new Error(`Receipt metadata/binary mapping mismatch for ${receipt.receiptId}.`);
    }
    const bytes = new Uint8Array(readFileSync(resolveVerifiedReceiptBinaryPath(root, receipt.receiptId, receipt.relativePath)));
    if (bytes.byteLength !== receipt.sizeBytes || sha256(bytes) !== receipt.sha256) throw new Error(`Receipt binary checksum mismatch for ${receipt.receiptId}.`);
    await verifyDecodedImage(bytes, receipt.mimeType);
    totalBytes += bytes.byteLength;
  }
  const availableCount = [...metadata.values()].filter((row) => row.contentState === "available").length;
  if (availableCount !== manifest.receipts.length) throw new Error("Not every available Receipt has one backed-up binary.");
  const profiles = new Map((rows.tables.profiles?.rows ?? []).map((row) => [String(row.$id), row]));
  assertAvatarBackupCoverage([...profiles.values()], manifest.avatars);
  const seenAvatars = new Set<string>();
  for (const avatar of manifest.avatars) {
    if (seenAvatars.has(avatar.userId)) throw new Error(`Duplicate avatar backup entry for ${avatar.userId}.`);
    seenAvatars.add(avatar.userId);
    const profile = profiles.get(avatar.userId);
    if (!profile || typeof profile.avatarFileId !== "string" || !profile.avatarFileId.startsWith("avatar_") || !profile.avatarUpdatedAt) {
      throw new Error(`Profile/avatar mapping mismatch for ${avatar.userId}.`);
    }
    const bytes = new Uint8Array(readFileSync(resolveVerifiedAvatarBinaryPath(root, avatar.userId, avatar.relativePath)));
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_AVATAR_BYTES || bytes.byteLength !== avatar.sizeBytes || sha256(bytes) !== avatar.sha256) {
      throw new Error(`Avatar binary checksum mismatch for ${avatar.userId}.`);
    }
    await verifyDecodedImage(bytes, avatar.mimeType, MAX_AVATAR_DECODED_PIXELS);
    totalBytes += bytes.byteLength;
  }
  const profileAvatarCount = [...profiles.values()].filter((profile) => typeof profile.avatarFileId === "string" && profile.avatarFileId.length > 0).length;
  if (profileAvatarCount !== manifest.avatars.length) throw new Error("Not every Profile avatar pointer has exactly one backed-up binary.");
  return { manifest, bytes: totalBytes };
}

const verifyIndex = process.argv.indexOf("--verify");
if (verifyIndex >= 0) {
  const directory = process.argv[verifyIndex + 1];
  if (!directory || !existsSync(directory)) throw new Error("Usage: --verify <backup-directory>");
  const verified = await verifyBackup(directory);
  console.log(JSON.stringify({ verify: true, directory: resolve(directory), receipts: verified.manifest.receipts.length, avatars: verified.manifest.avatars.length, binaryBytes: verified.bytes, counts: verified.manifest.tableCounts }, null, 2));
} else {
  const cliEnv = loadAppwriteCliEnv(process.argv);
  const client = new Client().setEndpoint(cliEnv.endpoint).setProject(cliEnv.projectId).setKey(cliEnv.runtimeApiKey);
  const tables = new TablesDB(client);
  const storage = new Storage(client);
  const backupParent = process.env.APPWRITE_BACKUP_DIR ?? join(homedir(), "hft-backups");
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const root = join(backupParent, `hft-backup-${stamp}`);
  const receiptDirectory = join(root, "receipts");
  const avatarDirectory = join(root, "avatars");
  mkdirSync(receiptDirectory, { recursive: true });
  mkdirSync(avatarDirectory, { recursive: true });

  const exported: Record<string, { count: number; rows: Array<Record<string, unknown>> }> = {};
  for (const tableId of TABLE_IDS) {
    const rows = await exportTable(tables, tableId);
    exported[tableId] = { count: rows.length, rows };
  }
  const metadataRows = exported.receipt_metadata?.rows ?? [];
  const knownStorageIds = new Set(metadataRows.map((row) => String(row.storageFileId)));
  const profileRows = exported.profiles?.rows ?? [];
  const avatarPointers = profileRows.filter((row) => typeof row.avatarFileId === "string" && row.avatarFileId.length > 0);
  for (const profile of avatarPointers) knownStorageIds.add(String(profile.avatarFileId));
  const storageFiles = await listStorageFiles(storage);
  const storageById = new Map(storageFiles.map((file) => [file.$id, file]));
  const manifestReceipts: ReceiptManifestEntry[] = [];
  for (const row of metadataRows) {
    const fileId = String(row.storageFileId);
    let downloaded: ArrayBuffer | undefined;
    try {
      downloaded = await storage.getFileDownload({ bucketId: BUCKET_ID, fileId });
    } catch (error) {
      if (Number((error as { code?: unknown }).code) !== 404) throw error;
    }
    if (row.contentState !== "available") {
      if (downloaded) throw new Error(`Terminal Receipt ${String(row.$id)} still has Storage content.`);
      continue;
    }
    if (!downloaded) throw new Error(`Available Receipt ${String(row.$id)} is missing Storage content.`);
    const bytes = new Uint8Array(downloaded);
    const mimeType = String(row.mimeType) as ReceiptManifestEntry["mimeType"];
    const digest = sha256(bytes);
    if (bytes.byteLength !== Number(row.sizeBytes) || digest !== String(row.checksum)) throw new Error(`Available Receipt ${String(row.$id)} failed size/checksum validation.`);
    await verifyDecodedImage(bytes, mimeType);
    const relativePath = `receipts/${String(row.$id)}.bin`;
    writeFileSync(join(root, relativePath), bytes);
    manifestReceipts.push({ receiptId: String(row.$id), relativePath, mimeType, sizeBytes: bytes.byteLength, sha256: digest });
  }
  const manifestAvatars: AvatarManifestEntry[] = [];
  for (const profile of avatarPointers) {
    const userId = String(profile.$id);
    const fileId = String(profile.avatarFileId);
    if (!fileId.startsWith("avatar_") || !profile.avatarUpdatedAt) throw new Error(`Profile ${userId} has invalid avatar infrastructure.`);
    const providerFile = storageById.get(fileId);
    if (!providerFile) throw new Error(`Profile ${userId} is missing its authoritative avatar binary.`);
    const mimeType = String(providerFile.mimeType) as AvatarManifestEntry["mimeType"];
    if (!(["image/jpeg", "image/png", "image/webp"] as const).includes(mimeType)) throw new Error(`Profile ${userId} has an unsupported avatar format.`);
    const bytes = new Uint8Array(await storage.getFileDownload({ bucketId: BUCKET_ID, fileId }));
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_AVATAR_BYTES || bytes.byteLength !== providerFile.sizeOriginal) throw new Error(`Profile ${userId} avatar size verification failed.`);
    await verifyDecodedImage(bytes, mimeType, MAX_AVATAR_DECODED_PIXELS);
    const relativePath = `avatars/${userId}.bin`;
    const digest = sha256(bytes);
    writeFileSync(join(root, relativePath), bytes);
    manifestAvatars.push({ userId, relativePath, mimeType, sizeBytes: bytes.byteLength, sha256: digest });
  }
  const orphans = storageFiles.filter((file) => !knownStorageIds.has(file.$id));
  if (orphans.length) throw new Error(`Backup refused: ${orphans.length} untracked private Storage file(s) require reconciliation.`);

  const rowsPayload = JSON.stringify({ createdAt: new Date().toISOString(), databaseId: DATABASE_ID, tables: exported }, null, 2);
  writeFileSync(join(root, "rows.json"), rowsPayload, "utf8");
  const manifest: BackupManifest = {
    formatVersion: 3,
    createdAt: new Date().toISOString(),
    projectId: cliEnv.projectId,
    scope: "database rows plus all authoritative private Receipt and Profile Picture binaries",
    rowsSha256: sha256(rowsPayload),
    tableCounts: Object.fromEntries(Object.entries(exported).map(([id, entry]) => [id, entry.count])),
    receipts: manifestReceipts,
    avatars: manifestAvatars,
  };
  const manifestPayload = JSON.stringify(manifest, null, 2);
  writeFileSync(join(root, "manifest.json"), manifestPayload, "utf8");
  writeFileSync(join(root, "manifest.sha256"), sha256(manifestPayload), "utf8");
  const verified = await verifyBackup(root);
  console.log(JSON.stringify({ written: root, verified: true, receipts: verified.manifest.receipts.length, avatars: verified.manifest.avatars.length, binaryBytes: verified.bytes, counts: manifest.tableCounts }, null, 2));
}
