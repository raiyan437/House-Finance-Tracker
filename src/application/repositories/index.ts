import type {
  AuditEvent,
  Card,
  Expense,
  ExpenseCardPrivateSnapshot,
  Household,
  JoinRequest,
  ReceiptMetadata,
  ReceiptMimeType,
  UserProfile,
} from "@/domain/records/domain-records";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import type { CardRemovalAction, CardRemovalResult } from "@/domain/cards/card-lifecycle";
import type { SettlementRecord, SettlementStatus } from "@/domain/settlements/settlement-types";
import type {
  CardId,
  CommandId,
  ExpenseId,
  HouseholdId,
  JoinRequestId,
  AuditEventId,
  ReceiptId,
  SettlementId,
  UserId,
} from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import type { CommandOutcome, IdempotencyDescriptor } from "@/application/idempotency/command-idempotency";

export interface UserProfileRepository {
  getById(userId: UserId): Promise<UserProfile | undefined>;
  getByIds(userIds: readonly UserId[]): Promise<readonly UserProfile[]>;
  findByEmailKey(emailKey: string): Promise<UserProfile | undefined>;
  create(profile: UserProfile): Promise<void>;
  update(profile: UserProfile): Promise<void>;
}

export interface HouseholdRepository {
  getById(householdId: HouseholdId): Promise<Household | undefined>;
  findByCode(code: string): Promise<Household | undefined>;
  create(household: Household): Promise<void>;
  updateDetails(household: Household): Promise<void>;
  markDeleted(household: Household): Promise<void>;
}

export interface MembershipRepository {
  get(householdId: HouseholdId, userId: UserId): Promise<MembershipSnapshot | undefined>;
  findActiveByUser(userId: UserId): Promise<MembershipSnapshot | undefined>;
  listByHousehold(householdId: HouseholdId): Promise<readonly MembershipSnapshot[]>;
  create(membership: MembershipSnapshot): Promise<void>;
  replace(membership: MembershipSnapshot): Promise<void>;
}

export interface JoinRequestRepository {
  getById(joinRequestId: JoinRequestId): Promise<JoinRequest | undefined>;
  findPendingByUser(userId: UserId): Promise<JoinRequest | undefined>;
  listByHousehold(householdId: HouseholdId): Promise<readonly JoinRequest[]>;
  create(request: JoinRequest): Promise<void>;
  transition(
    request: JoinRequest & Readonly<{ status: "rejected" | "cancelled" }>,
  ): Promise<void>;
}

export interface ExpenseRepository {
  getById(expenseId: ExpenseId): Promise<Expense | undefined>;
  listHouseholdHistory(householdId: HouseholdId): Promise<readonly Expense[]>;
  listActiveForBalances(householdId: HouseholdId): Promise<readonly Expense[]>;
  getPrivateCardSnapshot(expenseId: ExpenseId, ownerId: UserId): Promise<ExpenseCardPrivateSnapshot | undefined>;
}

export interface SettlementRepository {
  getById(settlementId: SettlementId): Promise<SettlementRecord | undefined>;
  listByHousehold(householdId: HouseholdId): Promise<readonly SettlementRecord[]>;
  findPendingForPair(householdId: HouseholdId, first: UserId, second: UserId): Promise<SettlementRecord | undefined>;
  createPending(settlement: SettlementRecord): Promise<void>;
  transitionPending(settlement: SettlementRecord): Promise<void>;
}

export interface CardRepository {
  getOwned(cardId: CardId, ownerId: UserId): Promise<Card | undefined>;
  listOwned(ownerId: UserId, includeArchived?: boolean): Promise<readonly Card[]>;
  getOwnedRemovalAction(cardId: CardId, ownerId: UserId): Promise<CardRemovalAction | undefined>;
  create(card: Card): Promise<void>;
  updateDetails(card: Card): Promise<void>;
  archive(card: Card): Promise<void>;
  deleteUnreferenced(cardId: CardId, ownerId: UserId): Promise<void>;
}

export interface ReceiptContent {
  readonly bytes: Uint8Array;
  readonly mimeType: ReceiptMimeType;
}

export interface ReceiptRepository {
  listForExpense(expenseId: ExpenseId): Promise<readonly ReceiptMetadata[]>;
  availableBytesByUploader(userId: UserId): Promise<number>;
  getMetadata(receiptId: ReceiptId): Promise<ReceiptMetadata | undefined>;
  readContent(receiptId: ReceiptId): Promise<ReceiptContent | undefined>;
  create(metadata: ReceiptMetadata, content: ReceiptContent): Promise<void>;
  deleteContentAndMarkUserDeleted(metadata: ReceiptMetadata): Promise<void>;
}

export interface ReceiptRetentionCursor {
  readonly createdAt: IsoInstant;
  readonly receiptId: ReceiptId;
}

export interface ReceiptRetentionRepository {
  findEligibleAvailableReceipts(input: Readonly<{
    cutoff: IsoInstant;
    after?: ReceiptRetentionCursor;
    limit: number;
  }>): Promise<readonly ReceiptMetadata[]>;
  removeContentIfPresent(receiptId: ReceiptId): Promise<"removed" | "already-missing">;
  markRetentionExpiredConditionally(input: Readonly<{
    receiptId: ReceiptId;
    expectedCreatedAt: IsoInstant;
    removedAt: IsoInstant;
  }>): Promise<"transitioned" | "terminal">;
}

export interface AuditEventRepository {
  append(event: AuditEvent): Promise<void>;
  listByHousehold(householdId: HouseholdId): Promise<readonly AuditEvent[]>;
}

export interface CommandOutcomeRepository {
  get(descriptor: Pick<IdempotencyDescriptor, "actorId" | "commandType" | "commandId">): Promise<CommandOutcome | undefined>;
}

export interface CurrentSession {
  getCurrentUserId(): Promise<UserId>;
  subscribe(listener: (userId: UserId) => void): () => void;
}

export interface ApplicationRepositories {
  readonly profiles: UserProfileRepository;
  readonly households: HouseholdRepository;
  readonly memberships: MembershipRepository;
  readonly joinRequests: JoinRequestRepository;
  readonly expenses: ExpenseRepository;
  readonly settlements: SettlementRepository;
  readonly cards: CardRepository;
  readonly receipts: ReceiptRepository;
  readonly auditEvents: AuditEventRepository;
  readonly commandOutcomes: CommandOutcomeRepository;
}

export type IdempotentCreateInput = Readonly<{ idempotency: IdempotencyDescriptor }>;

export interface DevelopmentIdentityController {
  listIdentityIds(): Promise<readonly UserId[]>;
  switchIdentity(userId: UserId): Promise<void>;
}

export interface AtomicApplicationPersistence {
  createHousehold(input: Readonly<{ household: Household; leaderMembership: MembershipSnapshot; auditEvent: AuditEvent }> & IdempotentCreateInput): Promise<string>;
  updateHousehold(input: Readonly<{ household: Household; auditEvent: AuditEvent }>): Promise<void>;
  createJoinRequest(input: Readonly<{ request: JoinRequest; auditEvent: AuditEvent }> & IdempotentCreateInput): Promise<string>;
  acceptJoinRequest(input: Readonly<{
    joinRequestId: JoinRequestId;
    actorId: UserId;
    resolvedAt: IsoInstant;
    auditEvent: AuditEvent;
  }>): Promise<void>;
  transitionJoinRequest(input: Readonly<{
    joinRequestId: JoinRequestId;
    actorId: UserId;
    status: "rejected" | "cancelled";
    resolvedAt: IsoInstant;
    auditEvent: AuditEvent;
  }>): Promise<void>;
  transferLeadership(input: Readonly<{
    householdId: HouseholdId;
    actorId: UserId;
    targetId: UserId;
    auditEvent: AuditEvent;
  }>): Promise<void>;
  leaveHousehold(input: Readonly<{
    householdId: HouseholdId;
    actorId: UserId;
    auditEvent: AuditEvent;
  }>): Promise<void>;
  removeHouseholdMember(input: Readonly<{
    householdId: HouseholdId;
    actorId: UserId;
    targetId: UserId;
    auditEvent: AuditEvent;
  }>): Promise<void>;
  deleteHousehold(input: Readonly<{
    householdId: HouseholdId;
    actorId: UserId;
    auditEvent: AuditEvent;
    joinRequestAuditIdBase: AuditEventId;
  }>): Promise<void>;
  createExpense(input: Readonly<{ expense: Expense; actorId?: UserId; commandId?: CommandId; relevantIntentDigest?: string; backdatedConfirmationToken?: string; selectedCardId?: CardId; receipts: readonly Readonly<{ metadata: ReceiptMetadata; content: ReceiptContent }>[]; auditEvent: AuditEvent }> & IdempotentCreateInput): Promise<string>;
  editExpense(input: Readonly<{
    expectedExpenseId: ExpenseId;
    actorId?: UserId;
    commandId?: CommandId;
    relevantIntentDigest?: string;
    backdatedConfirmationApplicable?: boolean;
    backdatedConfirmationToken?: string;
    expense: Expense;
    expectedRevision: number;
    selectedCardId?: CardId;
    receiptAdditions?: readonly Readonly<{ metadata: ReceiptMetadata; content: ReceiptContent }>[];
    receiptRemovals?: readonly ReceiptMetadata[];
    auditEvents: readonly AuditEvent[];
  }>): Promise<void>;
  createSettlement(input: Readonly<{ settlement: SettlementRecord; auditEvent: AuditEvent }> & IdempotentCreateInput): Promise<string>;
  transitionSettlement(input: Readonly<{ settlement: SettlementRecord; expectedStatus: SettlementStatus; auditEvent: AuditEvent }>): Promise<void>;
  createCard(input: Readonly<{ card: Card }> & IdempotentCreateInput): Promise<string>;
  updateCard(input: Readonly<{ card: Card; expectedUpdatedAt: string }>): Promise<void>;
  removeCard(input: Readonly<{
    cardId: CardId;
    ownerId: UserId;
    expectedAction: CardRemovalAction;
    occurredAt: IsoInstant;
  }>): Promise<CardRemovalResult>;
  createReceipt(input: Readonly<{ metadata: ReceiptMetadata; content: ReceiptContent; auditEvent: AuditEvent }> & IdempotentCreateInput): Promise<string>;
  deleteReceipt(input: Readonly<{ metadata: ReceiptMetadata; auditEvent: AuditEvent }>): Promise<void>;
}
