/**
 * R4 isolated-project restore. The complete backup is verified before writes;
 * available binaries are restored and checked before their metadata rows.
 * Production-project restores remain fail-closed and require a separate,
 * owner-approved disaster-recovery/cutover procedure.
 *
 * Usage: npx tsx scripts/appwrite-restore.mts --backup <directory> --target-database <id> --yes --isolated
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client, Storage, TablesDB } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import sharp from "sharp";
import { assertNotProduction, loadAppwriteCliEnv } from "./appwrite-cli-env";
import { resolveVerifiedReceiptBinaryPath } from "./receipt-backup-path";
import { resolveVerifiedAvatarBinaryPath } from "./avatar-backup-path";
import { assertAvatarBackupCoverage } from "./avatar-backup-integrity";

const MAX_RECEIPT_DECODED_PIXELS = 268_402_689;
const MAX_AVATAR_DECODED_PIXELS = 40_000_000;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

const backup = arg("--backup") ?? arg("--file");
const targetDatabase = arg("--target-database");
if (!backup || !targetDatabase || !process.argv.includes("--yes") || !process.argv.includes("--isolated")) {
  throw new Error("Usage: --backup <directory> --target-database <id> --yes --isolated");
}
const cliEnv = loadAppwriteCliEnv(process.argv);
assertNotProduction(cliEnv.projectId, "Restore");
if (targetDatabase === "hft" && !process.argv.includes("--allow-live-database-id")) {
  throw new Error('Restoring into database id "hft" requires --allow-live-database-id (the connected project must still be non-production).');
}

const root = resolve(backup);
const manifestRaw = readFileSync(join(root, "manifest.json"), "utf8");
if (sha256(manifestRaw) !== readFileSync(join(root, "manifest.sha256"), "utf8").trim()) throw new Error("Backup manifest checksum mismatch.");
const manifest = JSON.parse(manifestRaw) as {
  formatVersion: number;
  rowsSha256: string;
  receipts: Array<{ receiptId: string; relativePath: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; sizeBytes: number; sha256: string }>;
  avatars: Array<{ userId: string; relativePath: string; mimeType: "image/jpeg" | "image/png" | "image/webp"; sizeBytes: number; sha256: string }>;
};
if (manifest.formatVersion !== 3) throw new Error("Unsupported backup format.");
const rowsRaw = readFileSync(join(root, "rows.json"), "utf8");
if (sha256(rowsRaw) !== manifest.rowsSha256) throw new Error("Backup rows checksum mismatch.");
const parsed = JSON.parse(rowsRaw) as { tables: Record<string, { count: number; rows: Array<Record<string, unknown>> }> };
const receiptRows = new Map((parsed.tables.receipt_metadata?.rows ?? []).map((row) => [String(row.$id), row]));
const profileRows = new Map((parsed.tables.profiles?.rows ?? []).map((row) => [String(row.$id), row]));
assertAvatarBackupCoverage([...profileRows.values()], manifest.avatars);

const verifiedBinaries = new Map<string, Uint8Array>();
for (const entry of manifest.receipts) {
  if (verifiedBinaries.has(entry.receiptId)) throw new Error(`Duplicate Receipt backup entry for ${entry.receiptId}.`);
  const row = receiptRows.get(entry.receiptId);
  const bytes = new Uint8Array(readFileSync(resolveVerifiedReceiptBinaryPath(root, entry.receiptId, entry.relativePath)));
  if (!row || row.contentState !== "available" || row.mimeType !== entry.mimeType || Number(row.sizeBytes) !== entry.sizeBytes || row.checksum !== entry.sha256 || bytes.byteLength !== entry.sizeBytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`Receipt metadata/binary verification failed for ${entry.receiptId}.`);
  }
  const decoder = sharp(bytes, { failOn: "error", sequentialRead: true, limitInputPixels: MAX_RECEIPT_DECODED_PIXELS });
  const decoded = await decoder.metadata();
  const expectedFormat = entry.mimeType === "image/jpeg" ? "jpeg" : entry.mimeType.slice("image/".length);
  if (decoded.format !== expectedFormat || !decoded.width || !decoded.height || decoded.width * decoded.height > MAX_RECEIPT_DECODED_PIXELS) throw new Error(`Receipt ${entry.receiptId} is not a valid supported image.`);
  await decoder.stats();
  verifiedBinaries.set(entry.receiptId, bytes);
}
if ([...receiptRows.values()].filter((row) => row.contentState === "available").length !== verifiedBinaries.size) {
  throw new Error("The backup does not contain exactly one binary per available Receipt.");
}

const verifiedAvatars = new Map<string, Uint8Array>();
for (const entry of manifest.avatars) {
  if (verifiedAvatars.has(entry.userId)) throw new Error(`Duplicate avatar backup entry for ${entry.userId}.`);
  const profile = profileRows.get(entry.userId);
  const bytes = new Uint8Array(readFileSync(resolveVerifiedAvatarBinaryPath(root, entry.userId, entry.relativePath)));
  if (!profile || typeof profile.avatarFileId !== "string" || !profile.avatarFileId.startsWith("avatar_") || !profile.avatarUpdatedAt || bytes.byteLength < 1 || bytes.byteLength > MAX_AVATAR_BYTES || bytes.byteLength !== entry.sizeBytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`Profile/avatar verification failed for ${entry.userId}.`);
  }
  const decoder = sharp(bytes, { failOn: "error", sequentialRead: true, limitInputPixels: MAX_AVATAR_DECODED_PIXELS });
  const decoded = await decoder.metadata();
  const expectedFormat = entry.mimeType === "image/jpeg" ? "jpeg" : entry.mimeType.slice("image/".length);
  if (decoded.format !== expectedFormat || !decoded.width || !decoded.height || decoded.width * decoded.height > MAX_AVATAR_DECODED_PIXELS) throw new Error(`Profile avatar ${entry.userId} is not a valid supported image.`);
  await decoder.stats();
  verifiedAvatars.set(entry.userId, bytes);
}
if ([...profileRows.values()].filter((row) => typeof row.avatarFileId === "string" && row.avatarFileId.length > 0).length !== verifiedAvatars.size) {
  throw new Error("The backup does not contain exactly one binary per Profile avatar pointer.");
}

const client = new Client().setEndpoint(cliEnv.endpoint).setProject(cliEnv.projectId).setKey(cliEnv.runtimeApiKey);
const tables = new TablesDB(client);
const storage = new Storage(client);
const metadataKeys = new Set(["$id", "$createdAt", "$updatedAt", "$permissions", "$databaseId", "$tableId"]);
const dataOf = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => !metadataKeys.has(key)));
const restoredCounts: Record<string, number> = {};

// Non-Receipt rows first. Available Receipt metadata is deliberately withheld
// until its binary has been restored and verified in Storage.
for (const [tableId, entry] of Object.entries(parsed.tables)) {
  if (tableId === "receipt_metadata" || tableId === "profiles") continue;
  for (const row of entry.rows) await tables.upsertRow({ databaseId: targetDatabase, tableId, rowId: String(row.$id), data: dataOf(row) });
  restoredCounts[tableId] = entry.rows.length;
}

for (const entry of manifest.receipts) {
  const row = receiptRows.get(entry.receiptId)!;
  const fileId = String(row.storageFileId);
  const bytes = verifiedBinaries.get(entry.receiptId)!;
  try {
    await storage.createFile({ bucketId: "receipts", fileId, file: InputFile.fromBuffer(bytes, "receipt.bin"), permissions: [] });
  } catch (error) {
    if (Number((error as { code?: unknown }).code) !== 409) throw error;
  }
  const downloaded = new Uint8Array(await storage.getFileDownload({ bucketId: "receipts", fileId }));
  if (downloaded.byteLength !== entry.sizeBytes || sha256(downloaded) !== entry.sha256) throw new Error(`Restored Storage verification failed for ${entry.receiptId}.`);
}

for (const row of receiptRows.values()) {
  if (row.contentState === "available" && !verifiedBinaries.has(String(row.$id))) throw new Error(`Available Receipt ${String(row.$id)} has no restored binary.`);
  await tables.upsertRow({ databaseId: targetDatabase, tableId: "receipt_metadata", rowId: String(row.$id), data: dataOf(row) });
}
restoredCounts.receipt_metadata = receiptRows.size;

for (const entry of manifest.avatars) {
  const profile = profileRows.get(entry.userId)!;
  const fileId = String(profile.avatarFileId);
  const bytes = verifiedAvatars.get(entry.userId)!;
  const extension = entry.mimeType === "image/jpeg" ? "jpg" : entry.mimeType.slice("image/".length);
  try {
    await storage.createFile({ bucketId: "receipts", fileId, file: InputFile.fromBuffer(bytes, `avatar.${extension}`), permissions: [] });
  } catch (error) {
    if (Number((error as { code?: unknown }).code) !== 409) throw error;
  }
  const downloaded = new Uint8Array(await storage.getFileDownload({ bucketId: "receipts", fileId }));
  if (downloaded.byteLength !== entry.sizeBytes || sha256(downloaded) !== entry.sha256) throw new Error(`Restored avatar verification failed for ${entry.userId}.`);
}
for (const row of profileRows.values()) {
  if (typeof row.avatarFileId === "string" && !verifiedAvatars.has(String(row.$id))) throw new Error(`Profile ${String(row.$id)} has no restored avatar binary.`);
  await tables.upsertRow({ databaseId: targetDatabase, tableId: "profiles", rowId: String(row.$id), data: dataOf(row) });
}
restoredCounts.profiles = profileRows.size;
console.log(JSON.stringify({ restoredIntoProject: cliEnv.projectId, restoredIntoDatabase: targetDatabase, receiptBinaries: verifiedBinaries.size, avatarBinaries: verifiedAvatars.size, counts: restoredCounts, integrityVerified: true }, null, 2));
