import { ApplicationError } from "@/application/errors/application-error";
import { assertCommandOutcome, COMMAND_TYPES, type CommandOutcome } from "@/application/idempotency/command-idempotency";
import { expenseDate } from "@/domain/dates/expense-date";
import { EXPENSE_ICON_CATEGORIES, expenseIconCategory } from "@/domain/expenses/expense-icon-category";
import { CARD_COLOR_IDS, LEGACY_CARD_COLOR_IDS, cardColorId, type CardColorId } from "@/domain/cards/card-color";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import { basisPoints } from "@/domain/money/basis-points";
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
import {
  auditEventId,
  cardId,
  commandId,
  expenseId,
  expenseCommentId,
  householdId,
  joinRequestId,
  receiptId,
  settlementId,
  userId,
} from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { assertSettlementRecord } from "@/domain/settlements/settlement-invariants";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { z } from "zod";
import {
  activeMembershipUserKey,
  membershipKey,
  pendingJoinUserKey,
  pendingSettlementPairKey,
} from "./keys";
import type {
  AuditEventRecordV1,
  CardRecordV2,
  CommandOutcomeRecordV1,
  ExpenseCardPrivateRecordV2,
  ExpenseRecordV2,
  ExpenseRecordV3,
  ExpenseCommentRecordV1,
  HouseholdRecordV1,
  JoinRequestRecordV2,
  MembershipRecordV1,
  ReceiptMetadataRecordV2,
  SettlementRecordV1,
  UserProfileRecordV2,
} from "./records";

const recordVersion = z.literal(1);
const expenseRecordVersion = z.literal(3);
const cardRecordVersion = z.literal(2);
const trimmed = z.string().min(1).refine((value) => value.trim() === value);
const idText = trimmed;
const instantText = z.string();
const safeInteger = z.number().int().safe();

const profileSchema = z.union([
  z.object({ recordVersion, id: idText, displayName: trimmed, displayEmail: trimmed, emailKey: trimmed, createdAt: instantText, updatedAt: instantText }).strict(),
  z.object({ recordVersion: z.literal(2), id: idText, displayName: trimmed, displayEmail: trimmed, emailKey: trimmed, version: safeInteger.refine((value) => value >= 1), createdAt: instantText, updatedAt: instantText }).strict(),
]);
const householdSchema = z.object({ recordVersion, id: idText, name: trimmed, code: z.string(), createdAt: instantText, updatedAt: instantText, deletedAt: instantText.optional(), deletedByUserId: idText.optional() }).strict();
const membershipSchema = z.object({ recordVersion, key: trimmed, householdId: idText, userId: idText, status: z.enum(["active", "former"]), role: z.enum(["leader", "member"]), activeMembershipUserKey: trimmed.optional() }).strict();
const joinRequestFields = {
  id: idText,
  householdId: idText,
  userId: idText,
  createdAt: instantText,
  resolvedAt: instantText.optional(),
  resolvedByUserId: idText.optional(),
  pendingJoinUserKey: trimmed.optional(),
} as const;
const joinRequestSchemaV1 = z.object({
  recordVersion,
  ...joinRequestFields,
  status: z.enum(["pending", "accepted", "rejected", "cancelled"]),
}).strict();
const joinRequestSchemaV2 = z.object({
  recordVersion: z.literal(2),
  ...joinRequestFields,
  status: z.enum([
    "pending",
    "accepted",
    "rejected",
    "cancelled",
    "household-closed",
  ]),
}).strict();
const joinRequestSchema = z.union([joinRequestSchemaV1, joinRequestSchemaV2]);
const allocationSchema = z.object({ participantId: idText, sharePoisha: safeInteger }).strict();
const percentageEntrySchema = z.object({ participantId: idText, basisPoints: safeInteger }).strict();
const expenseRecordFields = {
  id: idText,
  householdId: idText,
  creatorId: idText,
  payerId: idText,
  name: trimmed,
  iconCategory: z.enum(EXPENSE_ICON_CATEGORIES).optional(),
  amountPoisha: safeInteger,
  expenseDate: z.string(),
  splitMethod: z.enum(["equal", "amount", "percentage"]),
  allocations: z.array(allocationSchema),
  paymentMethod: z.enum(["cash", "card"]),
  createdAt: instantText,
  updatedAt: instantText,
  deletedAt: instantText.optional(),
  deletedByUserId: idText.optional(),
} as const;
const expenseSchemaV1 = z.object({ recordVersion, ...expenseRecordFields }).strict();
const expenseSchema = z.object({
  recordVersion: expenseRecordVersion,
  ...expenseRecordFields,
  percentageEntries: z.array(percentageEntrySchema).optional(),
  revision: safeInteger.refine((value) => value >= 1),
}).strict();
const legacyPrivateCardSchema = z.object({ recordVersion, expenseId: idText, ownerId: idText, cardId: idText, cardNameSnapshot: trimmed, cardTypeSnapshot: z.enum(["debit", "credit"]), colorSnapshot: trimmed }).strict();
const privateCardSchema = z.object({ recordVersion: cardRecordVersion, expenseId: idText, ownerId: idText, cardId: idText, cardNameSnapshot: trimmed, cardTypeSnapshot: z.enum(["debit", "credit"]), colorIdSnapshot: z.enum(CARD_COLOR_IDS) }).strict();
const settlementSchema = z.object({ recordVersion, id: idText, householdId: idText, senderId: idText, receiverId: idText, amountPoisha: safeInteger, recommendationHouseholdId: idText, recommendationSenderId: idText, recommendationReceiverId: idText, recommendationAmountPoisha: safeInteger, createdAt: instantText, status: z.enum(["pending", "confirmed", "rejected", "cancelled"]), resolvedAt: instantText.optional(), pendingSettlementPairKey: trimmed.optional() }).strict();
const legacyCardSchema = z.object({ recordVersion, id: idText, ownerId: idText, name: trimmed, type: z.enum(["debit", "credit"]), color: trimmed, createdAt: instantText, updatedAt: instantText, archivedAt: instantText.optional() }).strict();
const cardSchema = z.object({ recordVersion: cardRecordVersion, id: idText, ownerId: idText, name: trimmed, type: z.enum(["debit", "credit"]), colorId: z.enum(CARD_COLOR_IDS), createdAt: instantText, updatedAt: instantText, archivedAt: instantText.optional() }).strict();
const receiptSchemaV1 = z.object({ recordVersion, id: idText, householdId: idText, expenseId: idText, createdByUserId: idText, mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), originalFilename: trimmed.optional(), sizeBytes: safeInteger, createdAt: instantText, deletedAt: instantText.optional(), deletedByUserId: idText.optional() }).strict();
const receiptSchema = z.object({ recordVersion: z.literal(2), id: idText, householdId: idText, expenseId: idText, createdByUserId: idText, mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), originalFilename: trimmed.optional(), sizeBytes: safeInteger, createdAt: instantText, contentStatus: z.enum(["available", "user-deleted", "retention-expired"]), contentRemovedAt: instantText.optional(), contentRemovedByUserId: idText.optional() }).strict();
const auditSchema = z.object({ recordVersion, id: idText, householdId: idText, actorId: idText, aggregateType: z.enum(["household", "membership", "join-request", "expense", "settlement", "card", "receipt"]), aggregateId: trimmed, action: trimmed, occurredAt: instantText, changedFields: z.array(trimmed) }).strict();
const commandOutcomeSchema = z.object({ recordVersion, key: trimmed, actorId: idText, commandType: z.enum(COMMAND_TYPES), commandId: idText, intentDigest: trimmed, resourceId: idText, completedAt: instantText }).strict();
const expenseCommentSchema = z.object({ recordVersion, id: idText, householdId: idText, expenseId: idText, authorUserId: idText, body: trimmed.max(1000), createdAt: instantText }).strict();

function parsed<T>(schema: z.ZodType<T>, value: unknown, store: string, key?: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApplicationError(
      "MALFORMED_PERSISTED_DATA",
      `Stored ${store} data failed validation.`,
      { store, key },
    );
  }
  return result.data;
}

function reconstructed<T>(store: string, key: string | undefined, build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      "MALFORMED_PERSISTED_DATA",
      `Stored ${store} data failed domain reconstruction.`,
      { store, key },
    );
  }
}

export const toProfileRecord = (value: UserProfile): UserProfileRecordV2 => {
  assertUserProfile(value);
  return { recordVersion: 2, id: value.userId, displayName: value.displayName, displayEmail: value.displayEmail, emailKey: value.emailKey, version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt };
};
export const fromProfileRecord = (raw: unknown, key?: string): UserProfile => {
  const value = parsed(profileSchema, raw, "userProfiles", key);
  return reconstructed("userProfiles", key, () => {
    const domain = { userId: userId(value.id), displayName: value.displayName, displayEmail: value.displayEmail, emailKey: value.emailKey, version: value.recordVersion === 2 ? value.version : 1, createdAt: isoInstant(value.createdAt), updatedAt: isoInstant(value.updatedAt) };
    assertUserProfile(domain);
    return Object.freeze(domain);
  });
};

export const toHouseholdRecord = (value: Household): HouseholdRecordV1 => {
  assertHousehold(value);
  return { recordVersion: 1, id: value.householdId, name: value.name, code: value.code, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(value.deletedAt ? { deletedAt: value.deletedAt, deletedByUserId: value.deletedByUserId } : {}) };
};
export const fromHouseholdRecord = (raw: unknown, key?: string): Household => {
  const value = parsed(householdSchema, raw, "households", key);
  return reconstructed("households", key, () => {
    const domain: Household = { householdId: householdId(value.id), name: value.name, code: value.code, createdAt: isoInstant(value.createdAt), updatedAt: isoInstant(value.updatedAt), ...(value.deletedAt ? { deletedAt: isoInstant(value.deletedAt), deletedByUserId: userId(value.deletedByUserId!) } : {}) };
    assertHousehold(domain);
    return Object.freeze(domain);
  });
};

export const toMembershipRecord = (value: MembershipSnapshot): MembershipRecordV1 => ({ recordVersion: 1, key: membershipKey(value.householdId, value.userId), householdId: value.householdId, userId: value.userId, status: value.status, role: value.role, ...(value.status === "active" ? { activeMembershipUserKey: activeMembershipUserKey(value.userId) } : {}) });
export const fromMembershipRecord = (raw: unknown, key?: string): MembershipSnapshot => {
  const value = parsed(membershipSchema, raw, "memberships", key);
  return reconstructed("memberships", key, () => {
    const household = householdId(value.householdId);
    const user = userId(value.userId);
    if (value.key !== membershipKey(household, user) || value.activeMembershipUserKey !== (value.status === "active" ? activeMembershipUserKey(user) : undefined)) {
      throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored membership keys are inconsistent.", { store: "memberships", key });
    }
    return Object.freeze({ householdId: household, userId: user, status: value.status, role: value.role });
  });
};

export const toJoinRequestRecord = (value: JoinRequest): JoinRequestRecordV2 => {
  assertJoinRequest(value);
  return { recordVersion: 2, id: value.joinRequestId, householdId: value.householdId, userId: value.userId, status: value.status, createdAt: value.createdAt, ...(value.resolvedAt ? { resolvedAt: value.resolvedAt, resolvedByUserId: value.resolvedByUserId } : {}), ...(value.status === "pending" ? { pendingJoinUserKey: pendingJoinUserKey(value.userId) } : {}) };
};
export const fromJoinRequestRecord = (raw: unknown, key?: string): JoinRequest => {
  const value = parsed(joinRequestSchema, raw, "joinRequests", key);
  return reconstructed("joinRequests", key, () => {
    const user = userId(value.userId);
    if (value.pendingJoinUserKey !== (value.status === "pending" ? pendingJoinUserKey(user) : undefined)) {
      throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored join-request uniqueness key is inconsistent.", { store: "joinRequests", key });
    }
    const domain: JoinRequest = { joinRequestId: joinRequestId(value.id), householdId: householdId(value.householdId), userId: user, status: value.status, createdAt: isoInstant(value.createdAt), ...(value.resolvedAt ? { resolvedAt: isoInstant(value.resolvedAt), resolvedByUserId: userId(value.resolvedByUserId!) } : {}) };
    assertJoinRequest(domain);
    return Object.freeze(domain);
  });
};

export const migrateExpenseRecordV1ToV2 = (
  raw: unknown,
  key?: string,
): ExpenseRecordV2 => {
  const value = parsed(expenseSchemaV1, raw, "expenses", key);
  return { ...value, recordVersion: 2 };
};

export const migrateExpenseRecordToV3 = (
  raw: unknown,
  key?: string,
): ExpenseRecordV3 => {
  const version = z.object({ recordVersion: z.union([z.literal(1), z.literal(2)]) }).passthrough().safeParse(raw);
  if (!version.success) {
    throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored expenses data failed validation.", { store: "expenses", key });
  }
  const value = version.data.recordVersion === 1
    ? migrateExpenseRecordV1ToV2(raw, key)
    : parsed(z.object({ recordVersion: z.literal(2), ...expenseRecordFields, percentageEntries: z.array(percentageEntrySchema).optional() }).strict(), raw, "expenses", key);
  const migrated: ExpenseRecordV3 = { ...value, recordVersion: 3, revision: 1 };
  fromExpenseRecord(migrated, key ?? value.id);
  return migrated;
};

export const toExpenseRecord = (value: Expense): ExpenseRecordV3 => {
  assertExpense(value);
  return { recordVersion: 3, id: value.expenseId, householdId: value.householdId, creatorId: value.creatorId, payerId: value.payerId, name: value.name, iconCategory: expenseIconCategory(value.iconCategory), amountPoisha: value.amount, expenseDate: value.expenseDate, splitMethod: value.splitMethod, ...(value.percentageEntries === undefined ? {} : { percentageEntries: value.percentageEntries.map((entry) => ({ participantId: entry.participantId, basisPoints: entry.basisPoints })) }), allocations: value.allocations.map((item) => ({ participantId: item.participantId, sharePoisha: item.share })), paymentMethod: value.payment.method, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(value.deletedAt ? { deletedAt: value.deletedAt, deletedByUserId: value.deletedByUserId } : {}) };
};
export const fromExpenseRecord = (raw: unknown, key?: string): Expense => {
  const value = parsed(expenseSchema, raw, "expenses", key);
  return reconstructed("expenses", key, () => {
    const domain: Expense = { expenseId: expenseId(value.id), householdId: householdId(value.householdId), creatorId: userId(value.creatorId), payerId: userId(value.payerId), name: value.name, iconCategory: expenseIconCategory(value.iconCategory), amount: positivePoisha(value.amountPoisha), expenseDate: expenseDate(value.expenseDate), splitMethod: value.splitMethod, ...(value.percentageEntries === undefined ? {} : { percentageEntries: value.percentageEntries.map((entry) => Object.freeze({ participantId: userId(entry.participantId), basisPoints: basisPoints(entry.basisPoints) })) }), allocations: value.allocations.map((item) => Object.freeze({ participantId: userId(item.participantId), share: poisha(item.sharePoisha) })), payment: value.paymentMethod === "cash" ? { method: "cash" } : { method: "card", cardReference: `private:${value.id}` }, revision: value.revision, createdAt: isoInstant(value.createdAt), updatedAt: isoInstant(value.updatedAt), ...(value.deletedAt ? { deletedAt: isoInstant(value.deletedAt), deletedByUserId: userId(value.deletedByUserId!) } : {}) };
    assertExpense(domain);
    return Object.freeze(domain);
  });
};

export const toExpenseCommentRecord = (value: ExpenseComment): ExpenseCommentRecordV1 => {
  assertExpenseComment(value);
  return { recordVersion: 1, id: value.commentId, householdId: value.householdId, expenseId: value.expenseId, authorUserId: value.authorUserId, body: value.body, createdAt: value.createdAt };
};

export const fromExpenseCommentRecord = (raw: unknown, key?: string): ExpenseComment => {
  const value = parsed(expenseCommentSchema, raw, "expenseComments", key);
  return reconstructed("expenseComments", key, () => {
    const result: ExpenseComment = { commentId: expenseCommentId(value.id), householdId: householdId(value.householdId), expenseId: expenseId(value.expenseId), authorUserId: userId(value.authorUserId), body: value.body, createdAt: isoInstant(value.createdAt) };
    assertExpenseComment(result);
    return Object.freeze(result);
  });
};

function migrateLegacyColor(value: string, store: "cards" | "expenseCardPrivateDetails"): CardColorId {
  if ((LEGACY_CARD_COLOR_IDS as readonly string[]).includes(value)) return cardColorId(value);
  if (value === "lime") return "mint";
  if (value === "blue") return "powder-blue";
  if (value === "gray") return "charcoal";
  throw new ApplicationError(
    "MALFORMED_PERSISTED_DATA",
    `Stored ${store} color data is unsupported.`,
    { store },
  );
}

export function migrateCardRecordV1ToV2(raw: unknown): CardRecordV2 {
  const value = parsed(legacyCardSchema, raw, "cards");
  return {
    recordVersion: 2,
    id: value.id,
    ownerId: value.ownerId,
    name: value.name,
    type: value.type,
    colorId: migrateLegacyColor(value.color, "cards"),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.archivedAt ? { archivedAt: value.archivedAt } : {}),
  };
}

export function migratePrivateCardRecordV1ToV2(raw: unknown): ExpenseCardPrivateRecordV2 {
  const value = parsed(legacyPrivateCardSchema, raw, "expenseCardPrivateDetails");
  return {
    recordVersion: 2,
    expenseId: value.expenseId,
    ownerId: value.ownerId,
    cardId: value.cardId,
    cardNameSnapshot: value.cardNameSnapshot,
    cardTypeSnapshot: value.cardTypeSnapshot,
    colorIdSnapshot: migrateLegacyColor(value.colorSnapshot, "expenseCardPrivateDetails"),
  };
}

export const toPrivateCardRecord = (value: ExpenseCardPrivateSnapshot): ExpenseCardPrivateRecordV2 => {
  assertExpenseCardPrivateSnapshot(value);
  return { recordVersion: 2, expenseId: value.expenseId, ownerId: value.ownerId, cardId: value.cardId, cardNameSnapshot: value.cardName, cardTypeSnapshot: value.cardType, colorIdSnapshot: value.colorId };
};
export const fromPrivateCardRecord = (raw: unknown, key?: string): ExpenseCardPrivateSnapshot => {
  const value = parsed(privateCardSchema, raw, "expenseCardPrivateDetails", key);
  return reconstructed("expenseCardPrivateDetails", key, () => {
    const domain = { expenseId: expenseId(value.expenseId), ownerId: userId(value.ownerId), cardId: cardId(value.cardId), cardName: value.cardNameSnapshot, cardType: value.cardTypeSnapshot, colorId: cardColorId(value.colorIdSnapshot) };
    assertExpenseCardPrivateSnapshot(domain);
    return Object.freeze(domain);
  });
};

export const toSettlementRecord = (value: SettlementRecord): SettlementRecordV1 => {
  assertSettlementRecord(value);
  return { recordVersion: 1, id: value.settlementId, householdId: value.householdId, senderId: value.senderId, receiverId: value.receiverId, amountPoisha: value.amount, recommendationHouseholdId: value.originatingRecommendation.householdId, recommendationSenderId: value.originatingRecommendation.senderId, recommendationReceiverId: value.originatingRecommendation.receiverId, recommendationAmountPoisha: value.originatingRecommendation.amount, createdAt: value.createdAt, status: value.status, ...(value.resolvedAt ? { resolvedAt: value.resolvedAt } : {}), ...(value.status === "pending" ? { pendingSettlementPairKey: pendingSettlementPairKey(value.householdId, value.senderId, value.receiverId) } : {}) };
};
export const fromSettlementRecord = (raw: unknown, key?: string): SettlementRecord => {
  const value = parsed(settlementSchema, raw, "settlements", key);
  return reconstructed("settlements", key, () => {
    const household = householdId(value.householdId);
    const sender = userId(value.senderId);
    const receiver = userId(value.receiverId);
    if (value.pendingSettlementPairKey !== (value.status === "pending" ? pendingSettlementPairKey(household, sender, receiver) : undefined)) {
      throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored settlement uniqueness key is inconsistent.", { store: "settlements", key });
    }
    const domain: SettlementRecord = { settlementId: settlementId(value.id), householdId: household, senderId: sender, receiverId: receiver, amount: positivePoisha(value.amountPoisha), originatingRecommendation: Object.freeze({ householdId: householdId(value.recommendationHouseholdId), senderId: userId(value.recommendationSenderId), receiverId: userId(value.recommendationReceiverId), amount: positivePoisha(value.recommendationAmountPoisha) }), createdAt: isoInstant(value.createdAt), status: value.status, ...(value.resolvedAt ? { resolvedAt: isoInstant(value.resolvedAt) } : {}) };
    assertSettlementRecord(domain);
    return Object.freeze(domain);
  });
};

export const toCardRecord = (value: Card): CardRecordV2 => { assertCard(value); return { recordVersion: 2, id: value.cardId, ownerId: value.ownerId, name: value.name, type: value.type, colorId: value.colorId, createdAt: value.createdAt, updatedAt: value.updatedAt, ...(value.archivedAt ? { archivedAt: value.archivedAt } : {}) }; };
export const fromCardRecord = (raw: unknown, key?: string): Card => { const value = parsed(cardSchema, raw, "cards", key); return reconstructed("cards", key, () => { const domain: Card = { cardId: cardId(value.id), ownerId: userId(value.ownerId), name: value.name, type: value.type, colorId: cardColorId(value.colorId), createdAt: isoInstant(value.createdAt), updatedAt: isoInstant(value.updatedAt), ...(value.archivedAt ? { archivedAt: isoInstant(value.archivedAt) } : {}) }; assertCard(domain); return Object.freeze(domain); }); };

export const toReceiptRecord = (value: ReceiptMetadata): ReceiptMetadataRecordV2 => { assertReceiptMetadata(value); return { recordVersion: 2, id: value.receiptId, householdId: value.householdId, expenseId: value.expenseId, createdByUserId: value.createdByUserId, mimeType: value.mimeType, ...(value.originalFilename ? { originalFilename: value.originalFilename } : {}), sizeBytes: value.sizeBytes, createdAt: value.createdAt, contentStatus: value.contentStatus, ...(value.contentRemovedAt ? { contentRemovedAt: value.contentRemovedAt } : {}), ...(value.contentRemovedByUserId ? { contentRemovedByUserId: value.contentRemovedByUserId } : {}) }; };
export const fromReceiptRecord = (raw: unknown, key?: string): ReceiptMetadata => { const value = parsed(receiptSchema, raw, "receiptMetadata", key); return reconstructed("receiptMetadata", key, () => { const domain: ReceiptMetadata = { receiptId: receiptId(value.id), householdId: householdId(value.householdId), expenseId: expenseId(value.expenseId), createdByUserId: userId(value.createdByUserId), mimeType: value.mimeType, ...(value.originalFilename ? { originalFilename: value.originalFilename } : {}), sizeBytes: value.sizeBytes, createdAt: isoInstant(value.createdAt), contentStatus: value.contentStatus, ...(value.contentRemovedAt ? { contentRemovedAt: isoInstant(value.contentRemovedAt) } : {}), ...(value.contentRemovedByUserId ? { contentRemovedByUserId: userId(value.contentRemovedByUserId) } : {}) }; assertReceiptMetadata(domain); return Object.freeze(domain); }); };

export function migrateReceiptRecordV1ToV2(raw: unknown): ReceiptMetadataRecordV2 {
  const value = parsed(receiptSchemaV1, raw, "receiptMetadata");
  if (Boolean(value.deletedAt) !== Boolean(value.deletedByUserId)) {
    throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored receipt deletion metadata is incomplete.", { store: "receiptMetadata", key: value.id });
  }
  const migrated: ReceiptMetadataRecordV2 = {
    recordVersion: 2,
    id: value.id,
    householdId: value.householdId,
    expenseId: value.expenseId,
    createdByUserId: value.createdByUserId,
    mimeType: value.mimeType,
    ...(value.originalFilename ? { originalFilename: value.originalFilename } : {}),
    sizeBytes: value.sizeBytes,
    createdAt: value.createdAt,
    contentStatus: value.deletedAt ? "user-deleted" : "available",
    ...(value.deletedAt ? { contentRemovedAt: value.deletedAt, contentRemovedByUserId: value.deletedByUserId } : {}),
  };
  fromReceiptRecord(migrated, value.id);
  return migrated;
}

export const toAuditRecord = (value: AuditEvent): AuditEventRecordV1 => { assertAuditEvent(value); return { recordVersion: 1, id: value.auditEventId, householdId: value.householdId, actorId: value.actorId, aggregateType: value.aggregateType, aggregateId: value.aggregateId, action: value.action, occurredAt: value.occurredAt, changedFields: [...value.changedFields] }; };
export const fromAuditRecord = (raw: unknown, key?: string): AuditEvent => { const value = parsed(auditSchema, raw, "auditEvents", key); return reconstructed("auditEvents", key, () => { const domain: AuditEvent = { auditEventId: auditEventId(value.id), householdId: householdId(value.householdId), actorId: userId(value.actorId), aggregateType: value.aggregateType, aggregateId: value.aggregateId, action: value.action, occurredAt: isoInstant(value.occurredAt), changedFields: Object.freeze([...value.changedFields]) }; assertAuditEvent(domain); return Object.freeze(domain); }); };

export const toCommandOutcomeRecord = (value: CommandOutcome): CommandOutcomeRecordV1 => {
  assertCommandOutcome(value);
  return { recordVersion: 1, key: JSON.stringify([value.actorId, value.commandType, value.commandId]), actorId: value.actorId, commandType: value.commandType, commandId: value.commandId, intentDigest: value.intentDigest, resourceId: value.resourceId, completedAt: value.completedAt };
};
export const fromCommandOutcomeRecord = (raw: unknown, key?: string): CommandOutcome => {
  const value = parsed(commandOutcomeSchema, raw, "commandOutcomes", key);
  return reconstructed("commandOutcomes", key, () => {
    const outcome: CommandOutcome = { actorId: userId(value.actorId), commandType: value.commandType, commandId: commandId(value.commandId), intentDigest: value.intentDigest, resourceId: value.resourceId, completedAt: isoInstant(value.completedAt) };
    assertCommandOutcome(outcome);
    if (value.key !== JSON.stringify([outcome.actorId, outcome.commandType, outcome.commandId]) || (key !== undefined && value.key !== key)) throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored command outcome key is inconsistent.");
    return Object.freeze(outcome);
  });
};
