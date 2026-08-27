import { ApplicationError } from "../errors/application-error";
import { commandId, userId, type CommandId, type UserId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";

export const COMMAND_TYPES = [
  // Protected creates (H6).
  "create-expense",
  "create-household",
  "send-join-request",
  "create-pending-settlement",
  "upload-receipt",
  "create-card",
  // R3 financial delivery: every externally submitted mutation is replay-safe.
  "edit-card",
  "remove-card",
  "edit-expense",
  "delete-expense",
  "confirm-settlement",
  "reject-settlement",
  "cancel-settlement",
  // R2 household lifecycle delivery (lost-response safety for every external mutation).
  "cancel-join-request",
  "accept-join-request",
  "reject-join-request",
  "leave-household",
  "remove-member",
  "transfer-leadership",
  "rename-household",
  "delete-household",
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
  // Authoritative intent digest = SHA-256 of the canonical serialization
  // (server-verified; identical for local and production providers).
  return `sha256:${sha256Hex(canonicalIntent(value))}`;
}

function sha256Hex(text: string): string {
  const message = new TextEncoder().encode(text);
  const bitLength = message.length * 8;
  const withPadding = new Uint8Array((((message.length + 8) >> 6) + 1) << 6);
  withPadding.set(message);
  withPadding[message.length] = 0x80;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 4, bitLength >>> 0, false);
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 0x100000000), false);

  const hashWords = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const roundConstants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const w = new Uint32Array(64);
  const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let block = 0; block < withPadding.length; block += 64) {
    for (let index = 0; index < 16; index += 1) {
      w[index] = view.getUint32(block + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15]!, 7) ^ rotr(w[index - 15]!, 18) ^ (w[index - 15]! >>> 3);
      const s1 = rotr(w[index - 2]!, 17) ^ rotr(w[index - 2]!, 19) ^ (w[index - 2]! >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hashWords;
    for (let index = 0; index < 64; index += 1) {
      const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
      const ch = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + S1 + ch + roundConstants[index]! + w[index]!) >>> 0;
      const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
      const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d! + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hashWords[0] = (hashWords[0]! + a!) >>> 0;
    hashWords[1] = (hashWords[1]! + b!) >>> 0;
    hashWords[2] = (hashWords[2]! + c!) >>> 0;
    hashWords[3] = (hashWords[3]! + d!) >>> 0;
    hashWords[4] = (hashWords[4]! + e!) >>> 0;
    hashWords[5] = (hashWords[5]! + f!) >>> 0;
    hashWords[6] = (hashWords[6]! + g!) >>> 0;
    hashWords[7] = (hashWords[7]! + h!) >>> 0;
  }
  return hashWords.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function binaryContentDigest(bytes: Uint8Array): string {
  return `local-fnv1a32:${fnv1a32(bytes)}`;
}
