import "server-only";
import { Query } from "node-appwrite";
import type {
  AuditEventRepository,
  CardRepository,
  CommandOutcomeRepository,
  ExpenseRepository,
  HouseholdRepository,
  JoinRequestRepository,
  MembershipRepository,
  ReceiptRepository,
  SettlementRepository,
  UserProfileRepository,
} from "@/application/repositories";
import { assertCommandOutcome, type CommandOutcome } from "@/application/idempotency/command-idempotency";
import { commandOutcomeRowId } from "../ids";
import type { CardRemovalAction } from "@/domain/cards/card-lifecycle";
import type { UserId, CardId, ExpenseId, HouseholdId, JoinRequestId, ReceiptId, SettlementId } from "@/domain/shared/identifiers";
import { compareUserIds, userId, commandId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import {
  mapAuditEvent,
  mapCard,
  mapCurrentProfile,
  mapExpense,
  mapHousehold,
  mapJoinRequest,
  mapMembership,
  mapPrivateExpenseCard,
  mapProfileDisplay,
  mapReceiptMetadata,
  mapSettlement,
} from "./mappers.server";
import { createTablesReader, type AppwriteRow, type TablesReader } from "./tables.server";

const TABLE = {
  profiles: "profiles",
  households: "households",
  memberships: "memberships",
  joinRequests: "join_requests",
  expenses: "expenses",
  expenseCardPrivateDetails: "expense_card_private_details",
  settlements: "settlements",
  cards: "cards",
  receiptMetadata: "receipt_metadata",
  auditEvents: "audit_events",
  commandOutcomes: "command_outcomes",
} as const;

/**
 * Authoritative pair identity for unordered Pending-settlement uniqueness.
 * The future command writer (R3) must persist exactly this derivation so the
 * read-side `findPendingForPair` keeps matching provider rows.
 */
export function settlementPairKey(householdIdValue: HouseholdId, first: UserId, second: UserId): string {
  const [lower, upper] = compareUserIds(first, second) <= 0 ? [first, second] : [second, first];
  return JSON.stringify([householdIdValue, lower, upper]);
}

class AppwriteUserProfileRepository implements UserProfileRepository {
  constructor(private readonly tables: TablesReader, private readonly actorId: UserId, private readonly actorEmail: string) {}
  /**
   * Full profile resolution is reserved for the authenticated actor: Appwrite
   * Auth owns every email, so no other member's contact-bearing profile exists
   * to return. Other members resolve exclusively through getByIds.
   */
  async getById(id: UserId) {
    if (id !== this.actorId) return undefined;
    const row = await this.tables.getRow(TABLE.profiles, id);
    return row ? mapCurrentProfile(row, this.actorEmail) : undefined;
  }
  async getByIds(ids: readonly UserId[]) {
    const uniqueIds = [...new Set(ids)];
    const rows = await Promise.all(uniqueIds.map(async (id) => ({ id, row: await this.tables.getRow(TABLE.profiles, id) })));
    return rows
      .filter((entry): entry is typeof entry & { row: AppwriteRow } => entry.row !== undefined)
      .map(({ row }) => {
        const display = mapProfileDisplay(row);
        return Object.freeze({ userId: display.userId, displayName: display.displayName });
      });
  }
  async create(): Promise<void> {
    throw new Error("Profile creation belongs to the idempotent authentication bootstrap, not the read plane.");
  }
}

class AppwriteHouseholdRepository implements HouseholdRepository {
  constructor(private readonly tables: TablesReader) {}
  async getById(id: HouseholdId) {
    const row = await this.tables.getRow(TABLE.households, id);
    if (!row || row.deletedAt) return undefined;
    return mapHousehold(row);
  }
  async findByCode(code: string) {
    const rows = await this.tables.listRows(TABLE.households, [Query.equal("code", code), Query.limit(2)]);
    const row = rows.find((candidate) => !candidate.deletedAt);
    return row ? mapHousehold(row) : undefined;
  }
  async create(): Promise<void> { throw new Error("Household writes are not part of the R1 read plane."); }
  async markDeleted(): Promise<void> { throw new Error("Household writes are not part of the R1 read plane."); }
}

class AppwriteMembershipRepository implements MembershipRepository {
  constructor(private readonly tables: TablesReader) {}
  async get(householdIdValue: HouseholdId, userIdValue: UserId) {
    const rows = await this.tables.listRows(TABLE.memberships, [Query.equal("householdId", householdIdValue), Query.equal("userId", userIdValue), Query.limit(2)]);
    const row = rows[0];
    return row ? mapMembership(row) : undefined;
  }
  async findActiveByUser(userIdValue: UserId) {
    const rows = await this.tables.listRows(TABLE.memberships, [Query.equal("userId", userIdValue), Query.equal("status", "active"), Query.limit(2)]);
    const row = rows[0];
    return row ? mapMembership(row) : undefined;
  }
  async listByHousehold(householdIdValue: HouseholdId) {
    const rows = await this.tables.listRows(TABLE.memberships, [Query.equal("householdId", householdIdValue)]);
    return rows.map(mapMembership);
  }
  async create(): Promise<void> { throw new Error("Membership writes are not part of the R1 read plane."); }
  async replace(): Promise<void> { throw new Error("Membership writes are not part of the R1 read plane."); }
}

class AppwriteJoinRequestRepository implements JoinRequestRepository {
  constructor(private readonly tables: TablesReader) {}
  async getById(id: JoinRequestId) {
    const row = await this.tables.getRow(TABLE.joinRequests, id);
    return row ? mapJoinRequest(row) : undefined;
  }
  async findPendingByUser(userIdValue: UserId) {
    const rows = await this.tables.listRows(TABLE.joinRequests, [Query.equal("userId", userIdValue), Query.equal("status", "pending"), Query.limit(2)]);
    const row = rows[0];
    return row ? mapJoinRequest(row) : undefined;
  }
  async listByHousehold(householdIdValue: HouseholdId) {
    const rows = await this.tables.listRows(TABLE.joinRequests, [Query.equal("householdId", householdIdValue)]);
    return rows.map(mapJoinRequest);
  }
  async create(): Promise<void> { throw new Error("Join-request writes are not part of the R1 read plane."); }
  async transition(): Promise<void> { throw new Error("Join-request writes are not part of the R1 read plane."); }
}

class AppwriteExpenseRepository implements ExpenseRepository {
  constructor(private readonly tables: TablesReader) {}
  async getById(id: ExpenseId) {
    const row = await this.tables.getRow(TABLE.expenses, id);
    return row ? mapExpense(row) : undefined;
  }
  async listHouseholdHistory(householdIdValue: HouseholdId) {
    const rows = await this.tables.listRows(TABLE.expenses, [Query.equal("householdId", householdIdValue)]);
    return rows
      .map(mapExpense)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  async listActiveForBalances(householdIdValue: HouseholdId) {
    const history = await this.listHouseholdHistory(householdIdValue);
    return history.filter((expense) => !expense.deletedAt);
  }
  /** Owner-private by construction: a non-owner receives `undefined`, never row contents. */
  async getPrivateCardSnapshot(expenseIdValue: ExpenseId, ownerId: UserId) {
    const row = await this.tables.getRow(TABLE.expenseCardPrivateDetails, expenseIdValue);
    if (!row || row.ownerId !== ownerId) return undefined;
    return mapPrivateExpenseCard(row);
  }
}

class AppwriteSettlementRepository implements SettlementRepository {
  constructor(private readonly tables: TablesReader) {}
  async getById(id: SettlementId) {
    const row = await this.tables.getRow(TABLE.settlements, id);
    return row ? mapSettlement(row) : undefined;
  }
  async listByHousehold(householdIdValue: HouseholdId) {
    const rows = await this.tables.listRows(TABLE.settlements, [Query.equal("householdId", householdIdValue)]);
    return rows
      .map(mapSettlement)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  async findPendingForPair(householdIdValue: HouseholdId, first: UserId, second: UserId) {
    const key = settlementPairKey(householdIdValue, first, second);
    const rows = await this.tables.listRows(TABLE.settlements, [Query.equal("householdId", householdIdValue), Query.equal("pairKey", key), Query.equal("status", "pending"), Query.limit(2)]);
    const row = rows[0];
    return row ? mapSettlement(row) : undefined;
  }
  async createPending(): Promise<void> { throw new Error("Settlement writes are not part of the R1 read plane."); }
  async transitionPending(): Promise<void> { throw new Error("Settlement writes are not part of the R1 read plane."); }
}

class AppwriteCardRepository implements CardRepository {
  constructor(private readonly tables: TablesReader) {}
  /** Owner-keyed: another user's card ID resolves to `undefined`, never to data. */
  async getOwned(cardIdValue: CardId, ownerId: UserId) {
    const row = await this.tables.getRow(TABLE.cards, cardIdValue);
    if (!row || row.ownerId !== ownerId) return undefined;
    return mapCard(row);
  }
  async listOwned(ownerId: UserId, includeArchived = false) {
    const rows = await this.tables.listRows(TABLE.cards, [Query.equal("ownerId", ownerId)]);
    return rows.map(mapCard).filter((card) => includeArchived || !card.archivedAt);
  }
  async getOwnedRemovalAction(cardIdValue: CardId, ownerId: UserId): Promise<CardRemovalAction | undefined> {
    const owned = await this.getOwned(cardIdValue, ownerId);
    if (!owned || owned.archivedAt) return undefined;
    const snapshots = await this.tables.listRows(TABLE.expenseCardPrivateDetails, [Query.equal("ownerId", ownerId)]);
    const referenced = snapshots.some((row) => row.cardId === cardIdValue);
    return referenced ? "archive" : "delete";
  }
  async create(): Promise<void> { throw new Error("Card writes are not part of the R1 read plane."); }
  async updateDetails(): Promise<void> { throw new Error("Card writes are not part of the R1 read plane."); }
  async archive(): Promise<void> { throw new Error("Card writes are not part of the R1 read plane."); }
  async deleteUnreferenced(): Promise<void> { throw new Error("Card writes are not part of the R1 read plane."); }
}

class AppwriteReceiptRepository implements ReceiptRepository {
  constructor(private readonly tables: TablesReader) {}
  async listForExpense(expenseIdValue: ExpenseId) {
    const rows = await this.tables.listRows(TABLE.receiptMetadata, [Query.equal("expenseId", expenseIdValue)]);
    return rows.map(mapReceiptMetadata);
  }
  async availableBytesByUploader(userIdValue: UserId) {
    const rows = await this.tables.listRows(TABLE.receiptMetadata, [Query.equal("uploaderId", userIdValue), Query.equal("contentState", "available")]);
    return rows.reduce((total, row) => total + mapReceiptMetadata(row).sizeBytes, 0);
  }
  async getMetadata(receiptIdValue: ReceiptId) {
    const row = await this.tables.getRow(TABLE.receiptMetadata, receiptIdValue);
    return row ? mapReceiptMetadata(row) : undefined;
  }
  async readContent(): Promise<never> {
    // Binary content intentionally does not exist in the R1 read plane; the
    // Storage proxy arrives with the R4 upload saga.
    throw new Error("Receipt binary reads arrive with the production storage slice.");
  }
  async create(): Promise<void> { throw new Error("Receipt writes are not part of the R1 read plane."); }
  async deleteContentAndMarkUserDeleted(): Promise<void> { throw new Error("Receipt writes are not part of the R1 read plane."); }
}

class AppwriteAuditEventRepository implements AuditEventRepository {
  constructor(private readonly tables: TablesReader) {}
  async append(): Promise<void> { throw new Error("Audit writes are not part of the R1 read plane."); }
  async listByHousehold(householdIdValue: HouseholdId) {
    const rows = await this.tables.listRows(TABLE.auditEvents, [Query.equal("householdId", householdIdValue)]);
    return rows.map(mapAuditEvent).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }
}

class AppwriteCommandOutcomeRepository implements CommandOutcomeRepository {
  constructor(private readonly tables: TablesReader) {}
  /** Replay lookup by derived deterministic row id; digest verification is upstream. */
  async get(descriptor: Parameters<CommandOutcomeRepository["get"]>[0]): Promise<CommandOutcome | undefined> {
    const rowId = commandOutcomeRowId({
      actorId: String(descriptor.actorId),
      commandType: descriptor.commandType,
      commandId: String(descriptor.commandId),
    });
    const row = await this.tables.getRow(TABLE.commandOutcomes, rowId);
    if (!row) return undefined;
    const outcome = {
      actorId: userId(String(row.actorId)),
      commandType: row.commandType as Parameters<CommandOutcomeRepository["get"]>[0]["commandType"],
      commandId: commandId(String(row.commandId)),
      intentDigest: String(row.intentDigest),
      resourceId: String(row.resourceId),
      completedAt: isoInstant(String(row.completedAt)),
    } satisfies CommandOutcome;
    assertCommandOutcome(outcome);
    return Object.freeze(outcome);
  }
}
export interface AppwriteReadRepositories {
  readonly profiles: UserProfileRepository;
  readonly commandOutcomes: CommandOutcomeRepository;
  readonly households: HouseholdRepository;
  readonly memberships: MembershipRepository;
  readonly joinRequests: JoinRequestRepository;
  readonly expenses: ExpenseRepository;
  readonly settlements: SettlementRepository;
  readonly cards: CardRepository;
  readonly receipts: ReceiptRepository;
  readonly auditEvents: AuditEventRepository;
}

export function createAppwriteReadRepositories(tables: TablesReader, actorId: UserId, actorEmail: string): AppwriteReadRepositories {
  return Object.freeze({
    commandOutcomes: new AppwriteCommandOutcomeRepository(tables),
    profiles: new AppwriteUserProfileRepository(tables, actorId, actorEmail),
    households: new AppwriteHouseholdRepository(tables),
    memberships: new AppwriteMembershipRepository(tables),
    joinRequests: new AppwriteJoinRequestRepository(tables),
    expenses: new AppwriteExpenseRepository(tables),
    settlements: new AppwriteSettlementRepository(tables),
    cards: new AppwriteCardRepository(tables),
    receipts: new AppwriteReceiptRepository(tables),
    auditEvents: new AppwriteAuditEventRepository(tables),
  });
}

export { createTablesReader };
