import { ApplicationError } from "../errors/application-error";
import { commandId, userId, type CommandId, type UserId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";

export const COMMAND_TYPES = [
  "create-expense",
  "create-household",
  "send-join-request",
  "create-pending-settlement",
  "upload-receipt",
  "create-card",
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface IdempotencyDescriptor {
  readonly actorId: UserId;
  readonly commandType: CommandType;
  readonly commandId: CommandId;
  readonly intentDigest: string;
}

export interface CommandOutcome extends IdempotencyDescriptor {
  readonly resourceId: string;
  readonly completedAt: IsoInstant;
}

export function commandOutcomeKey(input: Pick<IdempotencyDescriptor, "actorId" | "commandType" | "commandId">): string {
  userId(input.actorId);
  commandId(input.commandId);
  if (!COMMAND_TYPES.includes(input.commandType)) throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "Unsupported command type.");
  return JSON.stringify([input.actorId, input.commandType, input.commandId]);
}

export function assertCommandOutcome(value: CommandOutcome): void {
  commandOutcomeKey(value);
  if (!value.intentDigest || value.intentDigest.trim() !== value.intentDigest) throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored command outcome digest is invalid.");
  if (!value.resourceId || value.resourceId.trim() !== value.resourceId) throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored command outcome resource is invalid.");
  isoInstant(value.completedAt);
}

export function assertIdempotentIntent(existing: CommandOutcome, proposed: IdempotencyDescriptor): void {
  if (existing.intentDigest !== proposed.intentDigest) {
    throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for different content.");
  }
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function canonicalIntent(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function fnv1a32(values: Iterable<number>): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function canonicalIntentDigest(value: unknown): string {
  const encoded = new TextEncoder().encode(canonicalIntent(value));
  return `local-fnv1a32:${fnv1a32(encoded)}`;
}

export function binaryContentDigest(bytes: Uint8Array): string {
  return `local-fnv1a32:${fnv1a32(bytes)}`;
}
