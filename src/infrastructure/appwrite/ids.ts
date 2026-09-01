import { createHash } from "node:crypto";

const APPWRITE_ROW_ID_PATTERN = /^[A-Za-z0-9._-]{1,36}$/;
const DIGEST_LENGTH = 34;
const RECEIPT_RESOURCE_DIGEST_LENGTH = 28;
const AVATAR_RESOURCE_DIGEST_LENGTH = 29;

export const RECEIPT_STORAGE_PREFIX = "receipt_";
export const AVATAR_STORAGE_PREFIX = "avatar_";

export const GUARD_KINDS = [
  "active-membership",
  "active-leader",
  "pending-join",
  "pending-settlement",
  "financial",
] as const;
export const QUOTA_COUNTER_KINDS = ["quota-uploader", "quota-project"] as const;

export type GuardKind = (typeof GUARD_KINDS)[number] | (typeof QUOTA_COUNTER_KINDS)[number];

export function assertAppwriteRowId(id: string): void {
  if (!APPWRITE_ROW_ID_PATTERN.test(id)) throw new Error(`Generated Appwrite row ID violates provider constraints: ${id.length} chars.`);
}

function derivePrefixedId(prefix: string, logicalKey: string, digestLength = DIGEST_LENGTH): string {
  if (!logicalKey || logicalKey.trim() !== logicalKey) throw new Error("A logical key is required to derive an infrastructure row ID.");
  const value = `${prefix}${createHash("sha256").update(logicalKey).digest("hex").slice(0, digestLength)}`;
  assertAppwriteRowId(value);
  return value;
}

export function guardRowId(logicalKey: string): string {
  return derivePrefixedId("g_", logicalKey);
}

export function commandOutcomeRowId(descriptor: Readonly<{ actorId: string; commandType: string; commandId: string }>): string {
  return derivePrefixedId("c_", JSON.stringify([descriptor.actorId, descriptor.commandType, descriptor.commandId]));
}

function receiptCommandKey(actorId: string, commandType: string, commandId: string): string {
  return JSON.stringify([actorId, commandType, commandId]);
}

export function receiptReservationRowId(actorId: string, commandId: string): string {
  return derivePrefixedId("q_", receiptCommandKey(actorId, "upload-receipt", commandId), RECEIPT_RESOURCE_DIGEST_LENGTH);
}

export function receiptMetadataRowId(actorId: string, commandId: string): string {
  return derivePrefixedId("r_", receiptCommandKey(actorId, "upload-receipt", commandId), RECEIPT_RESOURCE_DIGEST_LENGTH);
}

export function receiptStorageFileId(actorId: string, commandId: string): string {
  return derivePrefixedId(RECEIPT_STORAGE_PREFIX, receiptCommandKey(actorId, "upload-receipt", commandId), RECEIPT_RESOURCE_DIGEST_LENGTH);
}

export function avatarStorageFileId(actorId: string, commandId: string): string {
  return derivePrefixedId(AVATAR_STORAGE_PREFIX, JSON.stringify([actorId, "replace-avatar", commandId]), AVATAR_RESOURCE_DIGEST_LENGTH);
}

export function isReceiptStorageFileId(fileId: string): boolean {
  return /^receipt_[a-f0-9]{28}$/.test(fileId);
}

export function isAvatarStorageFileId(fileId: string): boolean {
  return /^avatar_[a-f0-9]{29}$/.test(fileId);
}

export function receiptAuditRowId(actorId: string, commandType: "upload-receipt" | "remove-receipt", commandId: string): string {
  return derivePrefixedId("a_", receiptCommandKey(actorId, commandType, commandId));
}

/** Deterministic membership row id (membership composite key hashed into provider charset). */
export function membershipRowId(householdId: string, userId: string): string {
  return derivePrefixedId("m_", JSON.stringify([householdId, userId]));
}

export interface GuardRowIdentity {
  readonly id: string;
  readonly logicalKey: string;
}

export function assertGuardIdentity(row: GuardRowIdentity, expectedLogicalKey: string): void {
  if (!expectedLogicalKey || expectedLogicalKey.trim() !== expectedLogicalKey) throw new Error("A logical key is required to verify an infrastructure guard.");
  if (row.logicalKey !== expectedLogicalKey || row.id !== guardRowId(expectedLogicalKey)) {
    throw new Error(`Infrastructure guard identity mismatch: the stored guard does not belong to '${expectedLogicalKey}'.`);
  }
}
