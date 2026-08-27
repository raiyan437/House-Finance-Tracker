import { createHash } from "node:crypto";

const APPWRITE_ROW_ID_PATTERN = /^[A-Za-z0-9._-]{1,36}$/;
const DIGEST_LENGTH = 34;

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

function derivePrefixedId(prefix: string, logicalKey: string): string {
  if (!logicalKey || logicalKey.trim() !== logicalKey) throw new Error("A logical key is required to derive an infrastructure row ID.");
  return `${prefix}${createHash("sha256").update(logicalKey).digest("hex").slice(0, DIGEST_LENGTH)}`;
}

export function guardRowId(logicalKey: string): string {
  return derivePrefixedId("g_", logicalKey);
}

export function commandOutcomeRowId(descriptor: Readonly<{ actorId: string; commandType: string; commandId: string }>): string {
  return derivePrefixedId("c_", JSON.stringify([descriptor.actorId, descriptor.commandType, descriptor.commandId]));
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
