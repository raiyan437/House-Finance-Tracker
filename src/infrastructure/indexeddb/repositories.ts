import { ApplicationError } from "@/application/errors/application-error";
import { assertReceiptContentStructure } from "@/application/receipts/receipt-content-validation";
import type {
  AuditEventRepository,
  CardRepository,
  CommandOutcomeRepository,
  ExpenseRepository,
  ExpenseCommentRepository,
  HouseholdRepository,
  JoinRequestRepository,
  MembershipRepository,
  ReceiptContent,
  ReceiptRepository,
  ReceiptRetentionRepository,
  SettlementRepository,
  UserProfileRepository,
} from "@/application/repositories";
import { markReceiptContentRetentionExpired } from "@/domain/receipts/receipt-content-lifecycle";
import { DomainError } from "@/domain/shared/domain-error";
import type {
  CardId,
  ExpenseId,
  HouseholdId,
  JoinRequestId,
  ReceiptId,
  SettlementId,
  UserId,
} from "@/domain/shared/identifiers";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import type { IDBPDatabase } from "idb";
import {
  fromAuditRecord,
  fromCardRecord,
  fromCommandOutcomeRecord,
  fromExpenseRecord,
  fromExpenseCommentRecord,
  fromHouseholdRecord,
  fromJoinRequestRecord,
  fromMembershipRecord,
  fromPrivateCardRecord,
  fromProfileRecord,
  fromReceiptRecord,
  fromSettlementRecord,
  toAuditRecord,
  toCardRecord,
  toHouseholdRecord,
  toJoinRequestRecord,
  toMembershipRecord,
  toProfileRecord,
  toReceiptRecord,
  toSettlementRecord,
} from "./mappers";
import { membershipKey, pendingSettlementPairKey } from "./keys";
import type { HouseFinanceDatabase, ReceiptBlobRecordV1 } from "./records";
import type { DatabaseSource } from "./database";


function persistenceFailure(error: unknown): never {
  if (error instanceof ApplicationError || error instanceof DomainError) throw error;
  if (error instanceof DOMException && error.name === "ConstraintError") {
    throw new ApplicationError("CONFLICT", "The requested record conflicts with an existing local record.");
  }
  throw new ApplicationError("PERSISTENCE_FAILURE", "The local persistence operation failed.");
}

async function database(source: DatabaseSource): Promise<IDBPDatabase<HouseFinanceDatabase>> {
  return source;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored receipt content could not be read."));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored receipt content could not be read."));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(blob);
  });
}

function assertSettlementIdentityUnchanged(original: SettlementRecord, proposed: SettlementRecord): void {
  if (
    original.settlementId !== proposed.settlementId ||
    original.householdId !== proposed.householdId ||
    original.senderId !== proposed.senderId ||
    original.receiverId !== proposed.receiverId ||
    original.amount !== proposed.amount ||
    original.createdAt !== proposed.createdAt ||
    original.originatingRecommendation.householdId !== proposed.originatingRecommendation.householdId ||
    original.originatingRecommendation.senderId !== proposed.originatingRecommendation.senderId ||
    original.originatingRecommendation.receiverId !== proposed.originatingRecommendation.receiverId ||
    original.originatingRecommendation.amount !== proposed.originatingRecommendation.amount
  ) {
    throw new ApplicationError("CONFLICT", "Settlement financial history cannot be rewritten.");
  }
}

export class IndexedDbUserProfileRepository implements UserProfileRepository {
  constructor(private readonly source: DatabaseSource) {}
  async getById(id: UserId) { const raw = await (await database(this.source)).get("userProfiles", id); return raw ? fromProfileRecord(raw, id) : undefined; }
  async getByIds(ids: readonly UserId[]) { return Promise.all(ids.map((id) => this.getById(id))).then((values) => values.filter((value) => value !== undefined)); }
  async create(value: Parameters<UserProfileRepository["create"]>[0]) { try { await (await database(this.source)).add("userProfiles", toProfileRecord(value)); } catch (error) { persistenceFailure(error); } }
}

export class IndexedDbHouseholdRepository implements HouseholdRepository {
  constructor(private readonly source: DatabaseSource) {}
  async getById(id: HouseholdId) { const raw = await (await database(this.source)).get("households", id); return raw ? fromHouseholdRecord(raw, id) : undefined; }
  async findByCode(code: string) { const raw = await (await database(this.source)).getFromIndex("households", "code", code); return raw ? fromHouseholdRecord(raw, raw.id) : undefined; }
  async create(value: Parameters<HouseholdRepository["create"]>[0]) { try { await (await database(this.source)).add("households", toHouseholdRecord(value)); } catch (error) { persistenceFailure(error); } }
  async markDeleted(value: Parameters<HouseholdRepository["markDeleted"]>[0]) { try { if (!value.deletedAt) throw new ApplicationError("CONFLICT", "Household deletion state does not match the operation."); const db = await database(this.source); if (!(await db.getKey("households", value.householdId))) throw new ApplicationError("NOT_FOUND", "Household not found."); await db.put("households", toHouseholdRecord(value)); } catch (error) { persistenceFailure(error); } }
}

export class IndexedDbMembershipRepository implements MembershipRepository {
  constructor(private readonly source: DatabaseSource) {}
  async get(household: HouseholdId, user: UserId) { const key = membershipKey(household, user); const raw = await (await database(this.source)).get("memberships", key); return raw ? fromMembershipRecord(raw, key) : undefined; }
  async findActiveByUser(user: UserId) { const raw = await (await database(this.source)).getFromIndex("memberships", "activeMembershipUserKey", JSON.stringify([user])); return raw ? fromMembershipRecord(raw, raw.key) : undefined; }
  async listByHousehold(household: HouseholdId) { const raw = await (await database(this.source)).getAllFromIndex("memberships", "householdId", household); return raw.map((item) => fromMembershipRecord(item, item.key)); }
  async create(value: Parameters<MembershipRepository["create"]>[0]) { try { await (await database(this.source)).add("memberships", toMembershipRecord(value)); } catch (error) { persistenceFailure(error); } }
  async replace(value: Parameters<MembershipRepository["replace"]>[0]) { try { const db = await database(this.source); const key = membershipKey(value.householdId, value.userId); if (!(await db.getKey("memberships", key))) throw new ApplicationError("NOT_FOUND", "Membership not found."); await db.put("memberships", toMembershipRecord(value)); } catch (error) { persistenceFailure(error); } }
}

export class IndexedDbJoinRequestRepository implements JoinRequestRepository {
  constructor(private readonly source: DatabaseSource) {}
  async getById(id: JoinRequestId) { const raw = await (await database(this.source)).get("joinRequests", id); return raw ? fromJoinRequestRecord(raw, id) : undefined; }
  async findPendingByUser(user: UserId) { const raw = await (await database(this.source)).getFromIndex("joinRequests", "pendingJoinUserKey", JSON.stringify([user])); return raw ? fromJoinRequestRecord(raw, raw.id) : undefined; }
  async listByHousehold(household: HouseholdId) { const raw = await (await database(this.source)).getAllFromIndex("joinRequests", "householdId", household); return raw.map((item) => fromJoinRequestRecord(item, item.id)); }
  async create(value: Parameters<JoinRequestRepository["create"]>[0]) { try { if (value.status !== "pending") throw new ApplicationError("CONFLICT", "New join requests must be Pending."); await (await database(this.source)).add("joinRequests", toJoinRequestRecord(value)); } catch (error) { persistenceFailure(error); } }
  async transition(value: Parameters<JoinRequestRepository["transition"]>[0]) { try { if (value.status !== "rejected" && value.status !== "cancelled") throw new ApplicationError("CONFLICT", "Ordinary join-request actions cannot produce that terminal status."); const db = await database(this.source); const transaction = db.transaction("joinRequests", "readwrite"); const existingRaw = await transaction.store.get(value.joinRequestId); if (!existingRaw) throw new ApplicationError("NOT_FOUND", "Join request not found."); const existing = fromJoinRequestRecord(existingRaw, value.joinRequestId); if (existing.status !== "pending") throw new ApplicationError("CONFLICT", "Only Pending join requests may transition to an ordinary terminal state."); await transaction.store.put(toJoinRequestRecord(value)); await transaction.done; } catch (error) { persistenceFailure(error); } }
}

export class IndexedDbExpenseRepository implements ExpenseRepository {
  constructor(private readonly source: DatabaseSource) {}
  async getById(id: ExpenseId) { const raw = await (await database(this.source)).get("expenses", id); return raw ? fromExpenseRecord(raw, id) : undefined; }
  async listHouseholdHistory(household: HouseholdId) { const raw = await (await database(this.source)).getAllFromIndex("expenses", "householdId", household); return raw.map((item) => fromExpenseRecord(item, item.id)); }
  async listActiveForBalances(household: HouseholdId) { return (await this.listHouseholdHistory(household)).filter((item) => !item.deletedAt); }
  async getPrivateCardSnapshot(id: ExpenseId, owner: UserId) { const raw = await (await database(this.source)).get("expenseCardPrivateDetails", id); if (!raw || raw.ownerId !== owner) return undefined; return fromPrivateCardRecord(raw, id); }
}

export class IndexedDbExpenseCommentRepository implements ExpenseCommentRepository {
  constructor(private readonly source: DatabaseSource) {}
  async listForExpense(id: ExpenseId) {
    const db = await database(this.source);
    const range = IDBKeyRange.bound([id, "", ""], [id, "\uffff", "\uffff"]);
    const raw = await db.getAllFromIndex("expenseComments", "expenseCreatedAtId", range);
    return raw.map((item) => fromExpenseCommentRecord(item, item.id));
  }
  async countForExpenses(household: HouseholdId, ids: readonly ExpenseId[]) {
    const counts = new Map<ExpenseId, number>(ids.map((id) => [id, 0]));
    if (ids.length === 0) return counts;
    const wanted = new Set(ids);
    const raw = await (await database(this.source)).getAllFromIndex("expenseComments", "householdId", household);
    for (const item of raw) {
      const comment = fromExpenseCommentRecord(item, item.id);
      if (wanted.has(comment.expenseId)) counts.set(comment.expenseId, (counts.get(comment.expenseId) ?? 0) + 1);
    }
    return counts;
  }
}

export class IndexedDbSettlementRepository implements SettlementRepository {
  constructor(private readonly source: DatabaseSource) {}
  async getById(id: SettlementId) { const raw = await (await database(this.source)).get("settlements", id); return raw ? fromSettlementRecord(raw, id) : undefined; }
  async listByHousehold(household: HouseholdId) { const raw = await (await database(this.source)).getAllFromIndex("settlements", "householdId", household); return raw.map((item) => fromSettlementRecord(item, item.id)); }
  async findPendingForPair(household: HouseholdId, first: UserId, second: UserId) { const raw = await (await database(this.source)).getFromIndex("settlements", "pendingSettlementPairKey", pendingSettlementPairKey(household, first, second)); return raw ? fromSettlementRecord(raw, raw.id) : undefined; }
  async createPending(value: SettlementRecord) { try { if (value.status !== "pending") throw new ApplicationError("CONFLICT", "New settlements must be Pending."); await (await database(this.source)).add("settlements", toSettlementRecord(value)); } catch (error) { persistenceFailure(error); } }
  async transitionPending(value: SettlementRecord) { try { const db = await database(this.source); const transaction = db.transaction("settlements", "readwrite"); const raw = await transaction.store.get(value.settlementId); if (!raw) throw new ApplicationError("NOT_FOUND", "Settlement not found."); const existing = fromSettlementRecord(raw, value.settlementId); if (existing.status === "confirmed") throw new DomainError("CONFIRMED_SETTLEMENT_IMMUTABLE", "A confirmed settlement is immutable financial history."); if (existing.status !== "pending" || value.status === "pending") throw new ApplicationError("CONFLICT", "Only Pending settlements may transition to a terminal state."); assertSettlementIdentityUnchanged(existing, value); await transaction.store.put(toSettlementRecord(value)); await transaction.done; } catch (error) { persistenceFailure(error); } }
}

export class IndexedDbCardRepository implements CardRepository {
  constructor(private readonly source: DatabaseSource) {}
  async getOwned(id: CardId, owner: UserId) { const raw = await (await database(this.source)).get("cards", id); return raw && raw.ownerId === owner ? fromCardRecord(raw, id) : undefined; }
  async listOwned(owner: UserId, includeArchived = false) { const raw = await (await database(this.source)).getAllFromIndex("cards", "ownerId", owner); return raw.map((item) => fromCardRecord(item, item.id)).filter((item) => includeArchived || !item.archivedAt); }
  async getOwnedRemovalAction(id: CardId, owner: UserId) {
    const db = await database(this.source);
    const transaction = db.transaction(["cards", "expenseCardPrivateDetails"], "readonly");
    const raw = await transaction.objectStore("cards").get(id);
    if (!raw || raw.ownerId !== owner || raw.archivedAt) {
      await transaction.done;
      return undefined;
    }
    const referenced = Boolean(
      await transaction.objectStore("expenseCardPrivateDetails").index("cardId").getKey(id),
    );
    await transaction.done;
    return referenced ? "archive" as const : "delete" as const;
  }
  async create(value: Parameters<CardRepository["create"]>[0]) { try { if (value.archivedAt) throw new ApplicationError("CONFLICT", "A new card cannot be archived."); await (await database(this.source)).add("cards", toCardRecord(value)); } catch (error) { persistenceFailure(error); } }
  async updateDetails(value: Parameters<CardRepository["updateDetails"]>[0]) { try { const db = await database(this.source); const raw = await db.get("cards", value.cardId); if (!raw || raw.ownerId !== value.ownerId) throw new ApplicationError("NOT_FOUND", "Card not found."); if (raw.archivedAt || value.archivedAt) throw new ApplicationError("CONFLICT", "Archived cards cannot be edited."); await db.put("cards", toCardRecord(value)); } catch (error) { persistenceFailure(error); } }
  async archive(value: Parameters<CardRepository["archive"]>[0]) { try { if (!value.archivedAt) throw new ApplicationError("CONFLICT", "Archive operation requires an archived card."); const db = await database(this.source); const raw = await db.get("cards", value.cardId); if (!raw || raw.ownerId !== value.ownerId) throw new ApplicationError("NOT_FOUND", "Card not found."); await db.put("cards", toCardRecord(value)); } catch (error) { persistenceFailure(error); } }
  async deleteUnreferenced(id: CardId, owner: UserId) { try { const db = await database(this.source); const transaction = db.transaction(["cards", "expenseCardPrivateDetails"], "readwrite"); const raw = await transaction.objectStore("cards").get(id); if (!raw || raw.ownerId !== owner) throw new ApplicationError("NOT_FOUND", "Card not found."); if (await transaction.objectStore("expenseCardPrivateDetails").index("cardId").getKey(id)) throw new ApplicationError("CONFLICT", "Referenced cards must be archived instead of deleted."); await transaction.objectStore("cards").delete(id); await transaction.done; } catch (error) { persistenceFailure(error); } }
}

function receiptBlob(metadata: Parameters<ReceiptRepository["create"]>[0], content: ReceiptContent): ReceiptBlobRecordV1 {
  assertReceiptContentStructure(content);
  const bytes = new Uint8Array(content.bytes.byteLength);
  bytes.set(content.bytes);
  const blob = new Blob([bytes.buffer], { type: content.mimeType });
  if (blob.type !== metadata.mimeType || blob.size !== metadata.sizeBytes || content.mimeType !== metadata.mimeType) {
    throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt Blob metadata does not match its validated metadata.");
  }
  return { recordVersion: 1, receiptId: metadata.receiptId, blob };
}

export class IndexedDbReceiptRepository implements ReceiptRepository, ReceiptRetentionRepository {
  constructor(private readonly source: DatabaseSource) {}
  async listForExpense(id: ExpenseId) { const raw = await (await database(this.source)).getAllFromIndex("receiptMetadata", "expenseId", id); return raw.map((item) => fromReceiptRecord(item, item.id)); }
  async availableBytesByUploader(id: UserId) { const raw = await (await database(this.source)).getAllFromIndex("receiptMetadata", "uploaderContentStatus", [id, "available"]); return raw.reduce((total, item) => total + fromReceiptRecord(item, item.id).sizeBytes, 0); }
  async getMetadata(id: ReceiptId) { const raw = await (await database(this.source)).get("receiptMetadata", id); return raw ? fromReceiptRecord(raw, id) : undefined; }
  async readContent(id: ReceiptId) { const db = await database(this.source); const transaction = db.transaction(["receiptMetadata", "receiptBlobs"], "readonly"); const metadataRaw = await transaction.objectStore("receiptMetadata").get(id); const blobRaw = await transaction.objectStore("receiptBlobs").get(id); await transaction.done; if (!metadataRaw) return undefined; const metadata = fromReceiptRecord(metadataRaw, id); if (metadata.contentStatus !== "available") return undefined; if (!blobRaw) throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Available receipt content is missing.", { store: "receiptBlobs", key: id }); const blob = blobRaw.blob as Blob; if (blobRaw.recordVersion !== 1 || blobRaw.receiptId !== id || typeof blob?.size !== "number" || typeof blob?.type !== "string" || blob.type !== metadata.mimeType || blob.size !== metadata.sizeBytes) throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored receipt content failed validation.", { store: "receiptBlobs", key: id }); return { bytes: await blobBytes(blob), mimeType: metadata.mimeType }; }
  async create(metadata: Parameters<ReceiptRepository["create"]>[0], content: ReceiptContent) { try { const metadataRecord = toReceiptRecord(metadata); if (metadata.contentStatus !== "available") throw new ApplicationError("CONFLICT", "New receipt content must be available."); const blobRecord = receiptBlob(metadata, content); const db = await database(this.source); const transaction = db.transaction(["receiptMetadata", "receiptBlobs"], "readwrite"); await transaction.objectStore("receiptMetadata").add(metadataRecord); await transaction.objectStore("receiptBlobs").add(blobRecord); await transaction.done; } catch (error) { persistenceFailure(error); } }
  async deleteContentAndMarkUserDeleted(metadata: Parameters<ReceiptRepository["deleteContentAndMarkUserDeleted"]>[0]) { try { if (metadata.contentStatus !== "user-deleted") throw new ApplicationError("CONFLICT", "Receipt user deletion requires an explicit terminal state."); const db = await database(this.source); const transaction = db.transaction(["receiptMetadata", "receiptBlobs"], "readwrite"); const currentRaw = await transaction.objectStore("receiptMetadata").get(metadata.receiptId); if (!currentRaw) throw new ApplicationError("NOT_FOUND", "Receipt not found."); if (fromReceiptRecord(currentRaw, metadata.receiptId).contentStatus !== "available") throw new ApplicationError("CONFLICT", "Terminal receipt content cannot be overwritten."); await transaction.objectStore("receiptMetadata").put(toReceiptRecord(metadata)); await transaction.objectStore("receiptBlobs").delete(metadata.receiptId); await transaction.done; } catch (error) { persistenceFailure(error); } }
  async findEligibleAvailableReceipts(input: Parameters<ReceiptRetentionRepository["findEligibleAvailableReceipts"]>[0]) {
    try {
      const db = await database(this.source);
      const transaction = db.transaction("receiptMetadata", "readonly");
      const index = transaction.store.index("contentStatusCreatedAt");
      const range = IDBKeyRange.bound(["available", ""], ["available", input.cutoff], false, true);
      const matches = [];
      let cursor = await index.openCursor(range);
      while (cursor && matches.length < input.limit) {
        const metadata = fromReceiptRecord(cursor.value, cursor.primaryKey);
        const after = input.after;
        if (!after || metadata.createdAt > after.createdAt || (metadata.createdAt === after.createdAt && metadata.receiptId > after.receiptId)) {
          matches.push(metadata);
        }
        cursor = await cursor.continue();
      }
      await transaction.done;
      return matches;
    } catch (error) { persistenceFailure(error); }
  }
  async removeContentIfPresent(id: ReceiptId) {
    try {
      const db = await database(this.source);
      const transaction = db.transaction("receiptBlobs", "readwrite");
      const existed = Boolean(await transaction.store.getKey(id));
      if (existed) await transaction.store.delete(id);
      await transaction.done;
      return existed ? "removed" as const : "already-missing" as const;
    } catch (error) { persistenceFailure(error); }
  }
  async markRetentionExpiredConditionally(input: Parameters<ReceiptRetentionRepository["markRetentionExpiredConditionally"]>[0]) {
    try {
      const db = await database(this.source);
      const transaction = db.transaction("receiptMetadata", "readwrite");
      const raw = await transaction.store.get(input.receiptId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Receipt not found.");
      const current = fromReceiptRecord(raw, input.receiptId);
      if (current.contentStatus !== "available") {
        await transaction.done;
        return "terminal" as const;
      }
      if (current.createdAt !== input.expectedCreatedAt) {
        await transaction.done;
        throw new ApplicationError("CONFLICT", "Receipt creation time changed during retention.");
      }
      const expired = markReceiptContentRetentionExpired(current, input.removedAt);
      await transaction.store.put(toReceiptRecord(expired));
      await transaction.done;
      return "transitioned" as const;
    } catch (error) { persistenceFailure(error); }
  }
}

export class IndexedDbAuditEventRepository implements AuditEventRepository {
  constructor(private readonly source: DatabaseSource) {}
  async append(value: Parameters<AuditEventRepository["append"]>[0]) { try { await (await database(this.source)).add("auditEvents", toAuditRecord(value)); } catch (error) { persistenceFailure(error); } }
  async listByHousehold(household: HouseholdId) { const raw = await (await database(this.source)).getAllFromIndex("auditEvents", "householdId", household); return raw.map((item) => fromAuditRecord(item, item.id)).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)); }
}

export class IndexedDbCommandOutcomeRepository implements CommandOutcomeRepository {
  constructor(private readonly source: DatabaseSource) {}
  async get(descriptor: Parameters<CommandOutcomeRepository["get"]>[0]) {
    const key = JSON.stringify([descriptor.actorId, descriptor.commandType, descriptor.commandId]);
    const raw = await (await database(this.source)).get("commandOutcomes", key);
    return raw ? fromCommandOutcomeRecord(raw, key) : undefined;
  }
}

export class IndexedDbRepositories {
  readonly profiles: UserProfileRepository;
  readonly households: HouseholdRepository;
  readonly memberships: MembershipRepository;
  readonly joinRequests: JoinRequestRepository;
  readonly expenses: ExpenseRepository;
  readonly expenseComments: ExpenseCommentRepository;
  readonly settlements: SettlementRepository;
  readonly cards: CardRepository;
  readonly receipts: ReceiptRepository & ReceiptRetentionRepository;
  readonly auditEvents: AuditEventRepository;
  readonly commandOutcomes: CommandOutcomeRepository;

  constructor(source: DatabaseSource) {
    this.profiles = new IndexedDbUserProfileRepository(source);
    this.households = new IndexedDbHouseholdRepository(source);
    this.memberships = new IndexedDbMembershipRepository(source);
    this.joinRequests = new IndexedDbJoinRequestRepository(source);
    this.expenses = new IndexedDbExpenseRepository(source);
    this.expenseComments = new IndexedDbExpenseCommentRepository(source);
    this.settlements = new IndexedDbSettlementRepository(source);
    this.cards = new IndexedDbCardRepository(source);
    this.receipts = new IndexedDbReceiptRepository(source);
    this.auditEvents = new IndexedDbAuditEventRepository(source);
    this.commandOutcomes = new IndexedDbCommandOutcomeRepository(source);
  }
}

export { persistenceFailure, receiptBlob, assertSettlementIdentityUnchanged };
