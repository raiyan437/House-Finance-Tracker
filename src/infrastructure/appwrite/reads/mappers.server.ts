import "server-only";
import { z } from "zod";
import { ApplicationError } from "@/application/errors/application-error";
import { expenseDate } from "@/domain/dates/expense-date";
import { EXPENSE_ICON_CATEGORIES, expenseIconCategory } from "@/domain/expenses/expense-icon-category";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { basisPoints } from "@/domain/money/basis-points";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import {
  assertAuditEvent,
  assertCard,
  assertExpense,
  assertExpenseComment,
  assertExpenseCardPrivateSnapshot,
  assertHousehold,
  assertJoinRequest,
  assertReceiptMetadata,
  assertUserProfile,
  normalizeEmail,
  type AuditEvent,
  type Card,
  type Expense,
  type ExpenseComment,
  type ExpenseCardPrivateSnapshot,
  type Household,
  type JoinRequest,
  type ReceiptMetadata,
  type UserProfile,
} from "@/domain/records/domain-records";
import { cardColorId } from "@/domain/cards/card-color";
import { auditEventId, cardId, expenseCommentId, expenseId, householdId, joinRequestId, receiptId, settlementId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { assertSettlementRecord } from "@/domain/settlements/settlement-invariants";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";

const trimmed = z.string().min(1).refine((value) => value.trim() === value);
const optionalInstant = z.string().optional().nullable();
const rowId = (value: unknown) => trimmed.parse((value as Record<string, unknown>)?.$id);
const PROVIDER_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function providerInstant(value: string): ReturnType<typeof isoInstant> {
  if (!PROVIDER_ISO_INSTANT.test(value)) throw new Error("Provider datetime is not ISO 8601 with a timezone.");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Provider datetime is not a real instant.");
  return isoInstant(parsed.toISOString());
}

function malformed(table: string, build: () => unknown): never | unknown {
  try { return build(); } catch (error) {
    const kind = error instanceof ApplicationError
      ? error.code
      : error instanceof z.ZodError
        ? `ZOD:${error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",")}`
        : error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
        : error instanceof Error
          ? error.name
          : "unknown";
    console.error("[appwrite-mapper] validation failure", { table, kind });
    throw new ApplicationError("MALFORMED_PERSISTED_DATA", `Stored ${table} data failed validation.`, { store: table });
  }
}

function json<T>(raw: unknown, schema: z.ZodType<T>): T {
  if (typeof raw !== "string") throw new Error("JSON column is not text.");
  return schema.parse(JSON.parse(raw));
}

function safeInteger(raw: unknown): number {
  const value = typeof raw === "bigint" ? Number(raw) : typeof raw === "string" && /^-?\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Unsafe integer.");
  return value;
}

export interface ProfileDisplay { readonly userId: ReturnType<typeof userId>; readonly displayName: string; readonly version: number; readonly createdAt: ReturnType<typeof isoInstant>; readonly updatedAt: ReturnType<typeof isoInstant>; }

export function mapProfileDisplay(raw: unknown): ProfileDisplay {
  return malformed("profiles", () => {
    const value = z.object({ displayName: trimmed, version: z.number().int().min(1), createdAt: z.string(), updatedAt: z.string() }).passthrough().parse(raw);
    return Object.freeze({ userId: userId(rowId(raw)), displayName: value.displayName, version: value.version, createdAt: providerInstant(value.createdAt), updatedAt: providerInstant(value.updatedAt) });
  }) as ProfileDisplay;
}

export function mapCurrentProfile(raw: unknown, authoritativeEmail: string): UserProfile {
  return malformed("profiles", () => {
    const profile = mapProfileDisplay(raw);
    const email = normalizeEmail(authoritativeEmail);
    const value = { ...profile, ...email };
    assertUserProfile(value);
    return Object.freeze(value);
  }) as UserProfile;
}

export function mapHousehold(raw: unknown): Household {
  return malformed("households", () => {
    const value = z.object({ name: trimmed, code: z.string().regex(/^\d{9}$/), version: z.number().int().min(1), createdAt: z.string(), updatedAt: z.string(), deletedAt: optionalInstant, deletedByUserId: z.string().optional().nullable() }).passthrough().parse(raw);
    if (Boolean(value.deletedAt) !== Boolean(value.deletedByUserId)) throw new Error("Household deletion metadata must be complete.");
    const result: Household = { householdId: householdId(rowId(raw)), name: value.name, code: value.code, createdAt: providerInstant(value.createdAt), updatedAt: providerInstant(value.updatedAt), ...(value.deletedAt && value.deletedByUserId ? { deletedAt: providerInstant(value.deletedAt), deletedByUserId: userId(value.deletedByUserId) } : {}) };
    assertHousehold(result); return Object.freeze(result);
  }) as Household;
}

export function mapMembership(raw: unknown): MembershipSnapshot {
  return malformed("memberships", () => {
    const value = z.object({ householdId: trimmed, userId: trimmed, role: z.enum(["leader", "member"]), status: z.enum(["active", "former"]), joinedAt: z.string(), leftAt: optionalInstant, statusChangedAt: z.string(), version: z.number().int().min(0) }).passthrough().parse(raw);
    if ((value.status === "active" && value.leftAt) || (value.status === "former" && !value.leftAt)) throw new Error("Membership lifecycle mismatch.");
    providerInstant(value.joinedAt); providerInstant(value.statusChangedAt); if (value.leftAt) providerInstant(value.leftAt);
    return Object.freeze({ householdId: householdId(value.householdId), userId: userId(value.userId), role: value.role, status: value.status });
  }) as MembershipSnapshot;
}

export function mapJoinRequest(raw: unknown): JoinRequest {
  return malformed("join_requests", () => {
    const value = z.object({ householdId: trimmed, userId: trimmed, status: z.enum(["pending", "accepted", "rejected", "cancelled", "household-closed"]), createdAt: z.string(), resolvedAt: optionalInstant, resolvedByUserId: z.string().optional().nullable() }).passthrough().parse(raw);
    if ((value.status === "pending" && (value.resolvedAt || value.resolvedByUserId)) || (value.status !== "pending" && (!value.resolvedAt || !value.resolvedByUserId))) throw new Error("Join lifecycle mismatch.");
    const result: JoinRequest = { joinRequestId: joinRequestId(rowId(raw)), householdId: householdId(value.householdId), userId: userId(value.userId), status: value.status, createdAt: providerInstant(value.createdAt), ...(value.resolvedAt && value.resolvedByUserId ? { resolvedAt: providerInstant(value.resolvedAt), resolvedByUserId: userId(value.resolvedByUserId) } : {}) };
    assertJoinRequest(result); return Object.freeze(result);
  }) as JoinRequest;
}

const allocation = z.object({ participantId: trimmed, sharePoisha: z.union([z.number(), z.string(), z.bigint()]) }).strict();
const percentage = z.object({ participantId: trimmed, basisPoints: z.number().int().min(0).max(10_000) }).strict();

export function mapExpense(raw: unknown): Expense {
  return malformed("expenses", () => {
    const value = z.object({ householdId: trimmed, expenseDate: z.string(), amountPoisha: z.unknown(), payerId: trimmed, splitMethod: z.enum(["equal", "amount", "percentage"]), name: trimmed, iconCategory: z.enum(EXPENSE_ICON_CATEGORIES).optional().nullable(), paymentMethod: z.enum(["cash", "card"]), paymentRefJson: z.string(), allocationsJson: z.string(), percentageEntriesJson: z.string().optional().nullable(), revision: z.unknown(), createdBy: trimmed, createdAt: z.string(), updatedAt: z.string(), deletedAt: optionalInstant, deletedByUserId: z.string().optional().nullable() }).passthrough().parse(raw);
    if (Boolean(value.deletedAt) !== Boolean(value.deletedByUserId)) throw new Error("Expense deletion metadata must be complete.");
    const id = expenseId(rowId(raw));
    json(value.paymentRefJson, z.record(z.string(), z.unknown()));
    const allocations = json(value.allocationsJson, z.array(allocation)).map((item) => Object.freeze({ participantId: userId(item.participantId), share: poisha(safeInteger(item.sharePoisha)) }));
    const percentages = value.percentageEntriesJson ? json(value.percentageEntriesJson, z.array(percentage)).map((item) => Object.freeze({ participantId: userId(item.participantId), basisPoints: basisPoints(item.basisPoints) })) : undefined;
    const result: Expense = { expenseId: id, householdId: householdId(value.householdId), creatorId: userId(value.createdBy), payerId: userId(value.payerId), name: value.name, iconCategory: expenseIconCategory(value.iconCategory ?? undefined), amount: positivePoisha(safeInteger(value.amountPoisha)), expenseDate: expenseDate(value.expenseDate), splitMethod: value.splitMethod, ...(percentages ? { percentageEntries: percentages } : {}), allocations, payment: value.paymentMethod === "cash" ? { method: "cash" } : { method: "card", cardReference: `private:${id}` }, revision: safeInteger(value.revision), createdAt: providerInstant(value.createdAt), updatedAt: providerInstant(value.updatedAt), ...(value.deletedAt && value.deletedByUserId ? { deletedAt: providerInstant(value.deletedAt), deletedByUserId: userId(value.deletedByUserId) } : {}) };
    assertExpense(result); return Object.freeze(result);
  }) as Expense;
}

export function mapExpenseComment(raw: unknown): ExpenseComment {
  return malformed("expense_comments", () => {
    const value = z.object({ householdId: trimmed, expenseId: trimmed, authorUserId: trimmed, body: trimmed.max(1000), createdAt: z.string() }).passthrough().parse(raw);
    const result: ExpenseComment = { commentId: expenseCommentId(rowId(raw)), householdId: householdId(value.householdId), expenseId: expenseId(value.expenseId), authorUserId: userId(value.authorUserId), body: value.body, createdAt: providerInstant(value.createdAt) };
    assertExpenseComment(result);
    return Object.freeze(result);
  }) as ExpenseComment;
}

export function mapPrivateExpenseCard(raw: unknown): ExpenseCardPrivateSnapshot {
  return malformed("expense_card_private_details", () => {
    const value = z.object({ ownerId: trimmed, cardId: trimmed, cardName: z.string().optional().nullable(), snapshotJson: z.string(), createdAt: z.string() }).passthrough().parse(raw);
    providerInstant(value.createdAt);
    const snapshot = json(value.snapshotJson, z.union([
      z.object({ cardType: z.enum(["debit", "credit"]), colorId: trimmed }).strict(),
      z.object({ cardName: trimmed, cardType: z.enum(["debit", "credit"]), colorId: trimmed }).strict(),
    ]));
    const separateName = value.cardName?.trim();
    const legacyName = "cardName" in snapshot ? snapshot.cardName : undefined;
    const cardName = separateName || legacyName;
    if (!cardName) throw new Error("Private Card snapshot name is missing.");
    const result = { expenseId: expenseId(rowId(raw)), ownerId: userId(value.ownerId), cardId: cardId(value.cardId), cardName, cardType: snapshot.cardType, colorId: cardColorId(snapshot.colorId) };
    assertExpenseCardPrivateSnapshot(result); return Object.freeze(result);
  }) as ExpenseCardPrivateSnapshot;
}

export function mapSettlement(raw: unknown): SettlementRecord {
  return malformed("settlements", () => {
    const value = z.object({ householdId: trimmed, senderId: trimmed, receiverId: trimmed, amountPoisha: z.unknown(), originalAmountPoisha: z.unknown(), status: z.enum(["pending", "confirmed", "rejected", "cancelled"]), pairKey: trimmed, recommendationDigest: trimmed, resolvedAt: optionalInstant, createdAt: z.string() }).passthrough().parse(raw);
    if ((value.status === "pending" && value.resolvedAt) || (value.status !== "pending" && !value.resolvedAt)) throw new Error("Settlement lifecycle mismatch.");
    const amount = positivePoisha(safeInteger(value.amountPoisha));
    const result: SettlementRecord = { settlementId: settlementId(rowId(raw)), householdId: householdId(value.householdId), senderId: userId(value.senderId), receiverId: userId(value.receiverId), amount, originatingRecommendation: { householdId: householdId(value.householdId), senderId: userId(value.senderId), receiverId: userId(value.receiverId), amount: positivePoisha(safeInteger(value.originalAmountPoisha)) }, status: value.status, createdAt: providerInstant(value.createdAt), ...(value.resolvedAt ? { resolvedAt: providerInstant(value.resolvedAt) } : {}) };
    assertSettlementRecord(result); return Object.freeze(result);
  }) as SettlementRecord;
}

export function mapCard(raw: unknown): Card {
  return malformed("cards", () => {
    const value = z.object({ ownerId: trimmed, name: trimmed, design: trimmed, type: z.enum(["debit", "credit"]), status: z.enum(["active", "archived"]), archivedAt: optionalInstant, version: z.number().int().min(1), createdAt: z.string(), updatedAt: z.string() }).passthrough().parse(raw);
    if ((value.status === "active" && value.archivedAt) || (value.status === "archived" && !value.archivedAt)) throw new Error("Card lifecycle mismatch.");
    const result: Card = { cardId: cardId(rowId(raw)), ownerId: userId(value.ownerId), name: value.name, type: value.type, colorId: cardColorId(value.design), createdAt: providerInstant(value.createdAt), updatedAt: providerInstant(value.updatedAt), ...(value.archivedAt ? { archivedAt: providerInstant(value.archivedAt) } : {}) };
    assertCard(result); return Object.freeze(result);
  }) as Card;
}

export function mapReceiptMetadata(raw: unknown): ReceiptMetadata {
  return malformed("receipt_metadata", () => {
    const value = z.object({ uploaderId: trimmed, householdId: trimmed, expenseId: trimmed, mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), sizeBytes: z.number().int().safe().nonnegative(), contentState: z.enum(["available", "user-deleted", "retention-expired"]), contentRemovedAt: optionalInstant, contentRemovedByUserId: z.string().optional().nullable(), originalFilename: trimmed.optional().nullable(), createdAt: z.string() }).passthrough().parse(raw);
    if (Boolean(value.contentRemovedAt) !== Boolean(value.contentState !== "available")) throw new Error("Receipt lifecycle mismatch.");
    if (value.contentState === "user-deleted" && !value.contentRemovedByUserId) throw new Error("User-deleted receipts require the removing user.");
    const result: ReceiptMetadata = { receiptId: receiptId(rowId(raw)), householdId: householdId(value.householdId), expenseId: expenseId(value.expenseId), createdByUserId: userId(value.uploaderId), mimeType: value.mimeType, sizeBytes: value.sizeBytes, createdAt: providerInstant(value.createdAt), contentStatus: value.contentState, ...(value.originalFilename ? { originalFilename: value.originalFilename } : {}), ...(value.contentState !== "available" && value.contentRemovedAt ? { contentRemovedAt: providerInstant(value.contentRemovedAt) } : {}), ...(value.contentRemovedByUserId ? { contentRemovedByUserId: userId(value.contentRemovedByUserId) } : {}) };
    assertReceiptMetadata(result); return Object.freeze(result);
  }) as ReceiptMetadata;
}

export function mapAuditEvent(raw: unknown): AuditEvent {
  return malformed("audit_events", () => {
    const value = z.object({ householdId: trimmed, aggregateType: z.enum(["household", "membership", "join-request", "expense", "settlement", "card", "receipt"]), aggregateId: trimmed, actorId: trimmed, action: trimmed, changedFieldsJson: z.string(), occurredAt: z.string() }).passthrough().parse(raw);
    const result: AuditEvent = { auditEventId: auditEventId(rowId(raw)), householdId: householdId(value.householdId), actorId: userId(value.actorId), aggregateType: value.aggregateType, aggregateId: value.aggregateId, action: value.action, changedFields: Object.freeze(json(value.changedFieldsJson, z.array(trimmed))), occurredAt: providerInstant(value.occurredAt) };
    assertAuditEvent(result); return Object.freeze(result);
  }) as AuditEvent;
}
