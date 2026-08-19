import { ApplicationError } from "@/application/errors/application-error";
import type {
  AuditEventRepository,
  CardRepository,
  ExpenseRepository,
  HouseholdRepository,
  JoinRequestRepository,
  MembershipRepository,
  ReceiptContent,
  ReceiptRepository,
  SettlementRepository,
  UserProfileRepository,
} from "@/application/repositories";
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
  fromExpenseRecord,
  fromHouseholdRecord,
  fromJoinRequestRecord,
  fromMembershipRecord,
  fromPrivateCardRecord,
  fromProfileRecord,
  fromReceiptRecord,
  fromSettlementRecord,
  toAuditRecord,
  toCardRecord,
  toExpenseRecord,
  toHouseholdRecord,
  toJoinRequestRecord,
  toMembershipRecord,
  toProfileRecord,
  toReceiptRecord,
  toSettlementRecord,
} from "./mappers";
import { membershipKey, pendingSettlementPairKey } from "./keys";
import type { HouseFinanceDatabase, ReceiptBlobRecordV1 } from "./records";

type DatabaseSource = IDBPDatabase<HouseFinanceDatabase> | Promise<IDBPDatabase<HouseFinanceDatabase>>;

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
  async findByEmailKey(key: string) { const raw = await (await database(this.source)).getFromIndex("userProfiles", "emailKey", key); return raw ? fromProfileRecord(raw, raw.id) : undefined; }
  async create(value: Parameters<UserProfileRepository["create"]>[0]) { try { await (await database(this.source)).add("userProfiles", toProfileRecord(value)); } catch (error) { persistenceFailure(error); } }
  async update(value: Parameters<UserProfileRepository["update"]>[0]) { try { const db = await database(this.source); if (!(await db.getKey("userProfiles", value.userId))) throw new ApplicationError("NOT_FOUND", "Profile not found."); await db.put("userProfiles", toProfileRecord(value)); } catch (error) { persistenceFailure(error); } }
}

export class IndexedDbHouseholdRepository implements HouseholdRepository {
  constructor(private readonly source: DatabaseSource) {}
  async getById(id: HouseholdId) { const raw = await (await database(this.source)).get("households", id); return raw ? fromHouseholdRecord(raw, id) : undefined; }
  async findByCode(code: string) { const raw = await (await database(this.source)).getFromIndex("households", "code", code); return raw ? fromHouseholdRecord(raw, raw.id) : undefined; }
  async create(value: Parameters<HouseholdRepository["create"]>[0]) { try { await (await database(this.source)).add("households", toHouseholdRecord(value)); } catch (error) { persistenceFailure(error); } }
  async updateDetails(value: Parameters<HouseholdRepository["updateDetails"]>[0]) { await this.replace(value, false); }
  async markDeleted(value: Parameters<HouseholdRepository["markDeleted"]>[0]) { await this.replace(value, true); }
  private async replace(value: Parameters<HouseholdRepository["updateDetails"]>[0], mustBeDeleted: boolean) { try { if (mustBeDeleted !== Boolean(value.deletedAt)) throw new ApplicationError("CONFLICT", "Household deletion state does not match the operation."); const db = await database(this.source); if (!(await db.getKey("households", value.householdId))) throw new ApplicationError("NOT_FOUND", "Household not found."); await db.put("households", toHouseholdRecord(value)); } catch (error) { persistenceFailure(error); } }
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
  async transition(value: Parameters<JoinRequestRepository["transition"]>[0]) { try { const db = await database(this.source); const transaction = db.transaction("joinRequests", "readwrite"); const existingRaw = await transaction.store.get(value.joinRequestId); if (!existingRaw) throw new ApplicationError("NOT_FOUND", "Join request not found."); const existing = fromJoinRequestRecord(existingRaw, value.joinRequestId); if (existing.status !== "pending" || value.status === "pending") throw new ApplicationError("CONFLICT", "Only Pending join requests may transition to a terminal state."); await transaction.store.put(toJoinRequestRecord(value)); await transaction.done; } catch (error) { persistenceFailure(error); } }
}

export class IndexedDbExpenseRepository implements ExpenseRepository {
  constructor(private readonly source: DatabaseSource) {}
  async getById(id: ExpenseId) { const raw = await (await database(this.source)).get("expenses", id); return raw ? fromExpenseRecord(raw, id) : undefined; }
  async listHouseholdHistory(household: HouseholdId) { const raw = await (await database(this.source)).getAllFromIndex("expenses", "householdId", household); return raw.map((item) => fromExpenseRecord(item, item.id)); }
  async listActiveForBalances(household: HouseholdId) { return (await this.listHouseholdHistory(household)).filter((item) => !item.deletedAt); }
  async create(value: Parameters<ExpenseRepository["create"]>[0]) { try { await (await database(this.source)).add("expenses", toExpenseRecord(value)); } catch (error) { persistenceFailure(error); } }
  async replace(value: Parameters<ExpenseRepository["replace"]>[0]) { await this.replaceExisting(value, false); }
  async markDeleted(value: Parameters<ExpenseRepository["markDeleted"]>[0]) { await this.replaceExisting(value, true); }
  private async replaceExisting(value: Parameters<ExpenseRepository["replace"]>[0], mustBeDeleted: boolean) { try { if (mustBeDeleted !== Boolean(value.deletedAt)) throw new ApplicationError("CONFLICT", "Expense deletion state does not match the operation."); const db = await database(this.source); if (!(await db.getKey("expenses", value.expenseId))) throw new ApplicationError("NOT_FOUND", "Expense not found."); await db.put("expenses", toExpenseRecord(value)); } catch (error) { persistenceFailure(error); } }
  async getPrivateCardSnapshot(id: ExpenseId, owner: UserId) { const raw = await (await database(this.source)).get("expenseCardPrivateDetails", id); if (!raw || raw.ownerId !== owner) return undefined; return fromPrivateCardRecord(raw, id); }
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
  const signatureMatches =
    (content.mimeType === "image/jpeg" && content.bytes.length >= 3 && content.bytes[0] === 0xff && content.bytes[1] === 0xd8 && content.bytes[2] === 0xff) ||
    (content.mimeType === "image/png" && content.bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => content.bytes[index] === byte)) ||
    (content.mimeType === "image/webp" && content.bytes.length >= 12 && String.fromCharCode(...content.bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...content.bytes.slice(8, 12)) === "WEBP");
  if (!signatureMatches) {
    throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt bytes do not match the declared supported image type.");
  }
  const bytes = new Uint8Array(content.bytes.byteLength);
  bytes.set(content.bytes);
  const blob = new Blob([bytes.buffer], { type: content.mimeType });
  if (blob.type !== metadata.mimeType || blob.size !== metadata.sizeBytes || content.mimeType !== metadata.mimeType) {
    throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt Blob metadata does not match its validated metadata.");
  }
  return { recordVersion: 1, receiptId: metadata.receiptId, blob };
}

export class IndexedDbReceiptRepository implements ReceiptRepository {
  constructor(private readonly source: DatabaseSource) {}
  async listForExpense(id: ExpenseId) { const raw = await (await database(this.source)).getAllFromIndex("receiptMetadata", "expenseId", id); return raw.map((item) => fromReceiptRecord(item, item.id)); }
  async getMetadata(id: ReceiptId) { const raw = await (await database(this.source)).get("receiptMetadata", id); return raw ? fromReceiptRecord(raw, id) : undefined; }
  async readContent(id: ReceiptId) { const db = await database(this.source); const transaction = db.transaction(["receiptMetadata", "receiptBlobs"], "readonly"); const metadataRaw = await transaction.objectStore("receiptMetadata").get(id); const blobRaw = await transaction.objectStore("receiptBlobs").get(id); await transaction.done; if (!metadataRaw || !blobRaw) return undefined; const metadata = fromReceiptRecord(metadataRaw, id); if (metadata.deletedAt) return undefined; const blob = blobRaw.blob as Blob; if (blobRaw.recordVersion !== 1 || blobRaw.receiptId !== id || typeof blob?.size !== "number" || typeof blob?.type !== "string" || blob.type !== metadata.mimeType || blob.size !== metadata.sizeBytes) throw new ApplicationError("MALFORMED_PERSISTED_DATA", "Stored receipt content failed validation.", { store: "receiptBlobs", key: id }); return { bytes: await blobBytes(blob), mimeType: metadata.mimeType }; }
  async create(metadata: Parameters<ReceiptRepository["create"]>[0], content: ReceiptContent) { try { const metadataRecord = toReceiptRecord(metadata); if (metadata.deletedAt) throw new ApplicationError("CONFLICT", "A new receipt cannot be deleted."); const blobRecord = receiptBlob(metadata, content); const db = await database(this.source); const transaction = db.transaction(["receiptMetadata", "receiptBlobs"], "readwrite"); await transaction.objectStore("receiptMetadata").add(metadataRecord); await transaction.objectStore("receiptBlobs").add(blobRecord); await transaction.done; } catch (error) { persistenceFailure(error); } }
  async deleteContentAndTombstone(metadata: Parameters<ReceiptRepository["deleteContentAndTombstone"]>[0]) { try { if (!metadata.deletedAt) throw new ApplicationError("CONFLICT", "Receipt deletion requires a tombstone."); const db = await database(this.source); const transaction = db.transaction(["receiptMetadata", "receiptBlobs"], "readwrite"); if (!(await transaction.objectStore("receiptMetadata").getKey(metadata.receiptId))) throw new ApplicationError("NOT_FOUND", "Receipt not found."); await transaction.objectStore("receiptMetadata").put(toReceiptRecord(metadata)); await transaction.objectStore("receiptBlobs").delete(metadata.receiptId); await transaction.done; } catch (error) { persistenceFailure(error); } }
}

export class IndexedDbAuditEventRepository implements AuditEventRepository {
  constructor(private readonly source: DatabaseSource) {}
  async append(value: Parameters<AuditEventRepository["append"]>[0]) { try { await (await database(this.source)).add("auditEvents", toAuditRecord(value)); } catch (error) { persistenceFailure(error); } }
  async listByHousehold(household: HouseholdId) { const raw = await (await database(this.source)).getAllFromIndex("auditEvents", "householdId", household); return raw.map((item) => fromAuditRecord(item, item.id)).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)); }
}

export class IndexedDbRepositories {
  readonly profiles: UserProfileRepository;
  readonly households: HouseholdRepository;
  readonly memberships: MembershipRepository;
  readonly joinRequests: JoinRequestRepository;
  readonly expenses: ExpenseRepository;
  readonly settlements: SettlementRepository;
  readonly cards: CardRepository;
  readonly receipts: ReceiptRepository;
  readonly auditEvents: AuditEventRepository;

  constructor(source: DatabaseSource) {
    this.profiles = new IndexedDbUserProfileRepository(source);
    this.households = new IndexedDbHouseholdRepository(source);
    this.memberships = new IndexedDbMembershipRepository(source);
    this.joinRequests = new IndexedDbJoinRequestRepository(source);
    this.expenses = new IndexedDbExpenseRepository(source);
    this.settlements = new IndexedDbSettlementRepository(source);
    this.cards = new IndexedDbCardRepository(source);
    this.receipts = new IndexedDbReceiptRepository(source);
    this.auditEvents = new IndexedDbAuditEventRepository(source);
  }
}

export { persistenceFailure, receiptBlob, assertSettlementIdentityUnchanged };
