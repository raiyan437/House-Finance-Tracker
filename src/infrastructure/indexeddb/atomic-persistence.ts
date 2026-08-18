import { ApplicationError } from "@/application/errors/application-error";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { DomainError } from "@/domain/shared/domain-error";
import {
  assertFormerMemberChangeAllowed,
  assertLegacyPercentageChangeAllowed,
  type ExpenseFinancialFingerprint,
} from "@/domain/expenses/expense-financial-fingerprint";
import type { Expense } from "@/domain/records/domain-records";
import type { IDBPDatabase, IDBPTransaction, StoreNames } from "idb";
import {
  assertSettlementIdentityUnchanged,
  persistenceFailure,
  receiptBlob,
} from "./repositories";
import {
  fromCardRecord,
  fromExpenseRecord,
  fromJoinRequestRecord,
  fromMembershipRecord,
  fromSettlementRecord,
  toAuditRecord,
  toCardRecord,
  toExpenseRecord,
  toHouseholdRecord,
  toJoinRequestRecord,
  toMembershipRecord,
  toPrivateCardRecord,
  toReceiptRecord,
  toSettlementRecord,
} from "./mappers";
import {
  activeMembershipUserKey,
  membershipKey,
  pendingJoinUserKey,
} from "./keys";
import type { HouseFinanceDatabase } from "./records";

type DatabaseSource = IDBPDatabase<HouseFinanceDatabase> | Promise<IDBPDatabase<HouseFinanceDatabase>>;

function abortSafely(transaction: IDBPTransaction<HouseFinanceDatabase, StoreNames<HouseFinanceDatabase>[], "readwrite">): void {
  void transaction.done.catch(() => undefined);
  try {
    transaction.abort();
  } catch {
    // The transaction may already have failed and aborted itself.
  }
}

function expenseFingerprint(expense: Expense): ExpenseFinancialFingerprint {
  return {
    householdId: expense.householdId,
    amount: expense.amount,
    payerId: expense.payerId,
    splitMethod: expense.splitMethod,
    percentageEntries: expense.percentageEntries,
    allocations: expense.allocations,
    expenseDate: expense.expenseDate,
    payment: expense.payment,
    deleted: Boolean(expense.deletedAt),
  };
}

export class IndexedDbAtomicApplicationPersistence implements AtomicApplicationPersistence {
  constructor(private readonly source: DatabaseSource) {}

  private async db(): Promise<IDBPDatabase<HouseFinanceDatabase>> { return this.source; }

  async createHousehold(input: Parameters<AtomicApplicationPersistence["createHousehold"]>[0]): Promise<void> {
    const household = toHouseholdRecord(input.household);
    const membership = toMembershipRecord(input.leaderMembership);
    const audit = toAuditRecord(input.auditEvent);
    if (
      input.leaderMembership.status !== "active" ||
      input.leaderMembership.role !== "leader" ||
      input.leaderMembership.householdId !== input.household.householdId
    ) {
      throw new ApplicationError("CONFLICT", "Household creation requires a matching active leader membership.");
    }
    const tx = (await this.db()).transaction(["households", "memberships", "joinRequests", "auditEvents"], "readwrite");
    try {
      const [activeMembership, pendingRequest] = await Promise.all([
        tx.objectStore("memberships").index("activeMembershipUserKey").getKey(activeMembershipUserKey(input.leaderMembership.userId)),
        tx.objectStore("joinRequests").index("pendingJoinUserKey").getKey(pendingJoinUserKey(input.leaderMembership.userId)),
      ]);
      if (activeMembership) throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
      if (pendingRequest) throw new ApplicationError("CONFLICT", "Cancel the current Pending join request first.");
      await tx.objectStore("households").add(household);
      await tx.objectStore("memberships").add(membership);
      await tx.objectStore("auditEvents").add(audit);
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async updateHousehold(input: Parameters<AtomicApplicationPersistence["updateHousehold"]>[0]): Promise<void> {
    if (input.household.deletedAt) throw new ApplicationError("CONFLICT", "Deleted households cannot be renamed.");
    const tx = (await this.db()).transaction(["households", "auditEvents"], "readwrite");
    try { if (!(await tx.objectStore("households").getKey(input.household.householdId))) throw new ApplicationError("NOT_FOUND", "Household not found."); await tx.objectStore("households").put(toHouseholdRecord(input.household)); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async createJoinRequest(input: Parameters<AtomicApplicationPersistence["createJoinRequest"]>[0]): Promise<void> {
    const request = toJoinRequestRecord(input.request);
    if (input.request.status !== "pending") throw new ApplicationError("CONFLICT", "New join requests must be Pending.");
    const tx = (await this.db()).transaction(["memberships", "joinRequests", "auditEvents"], "readwrite");
    try {
      const [activeMembership, pendingRequest] = await Promise.all([
        tx.objectStore("memberships").index("activeMembershipUserKey").getKey(activeMembershipUserKey(input.request.userId)),
        tx.objectStore("joinRequests").index("pendingJoinUserKey").getKey(pendingJoinUserKey(input.request.userId)),
      ]);
      if (activeMembership) throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
      if (pendingRequest) throw new ApplicationError("CONFLICT", "The current user already has a Pending join request.");
      await tx.objectStore("joinRequests").add(request);
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async acceptJoinRequest(input: Parameters<AtomicApplicationPersistence["acceptJoinRequest"]>[0]): Promise<void> {
    const request = toJoinRequestRecord(input.request);
    const membership = toMembershipRecord(input.membership);
    if (input.request.status !== "accepted" || input.membership.status !== "active" || input.request.userId !== input.membership.userId || input.request.householdId !== input.membership.householdId) throw new ApplicationError("CONFLICT", "Accepted request and membership must describe the same active member.");
    const tx = (await this.db()).transaction(["joinRequests", "memberships", "auditEvents"], "readwrite");
    try {
      const existingRaw = await tx.objectStore("joinRequests").get(input.request.joinRequestId);
      if (!existingRaw || fromJoinRequestRecord(existingRaw, input.request.joinRequestId).status !== "pending") throw new ApplicationError("CONFLICT", "Only a persisted Pending request may be accepted.");
      const activeMembership = await tx.objectStore("memberships").index("activeMembershipUserKey").getKey(activeMembershipUserKey(input.request.userId));
      if (activeMembership) throw new ApplicationError("CONFLICT", "Requester already belongs to a household.");
      await tx.objectStore("joinRequests").put(request);
      await tx.objectStore("memberships").add(membership);
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async transitionJoinRequest(input: Parameters<AtomicApplicationPersistence["transitionJoinRequest"]>[0]): Promise<void> {
    if (input.request.status === "pending" || input.request.status === "accepted") throw new ApplicationError("CONFLICT", "This operation supports only rejection or cancellation.");
    const tx = (await this.db()).transaction(["joinRequests", "auditEvents"], "readwrite");
    try { const raw = await tx.objectStore("joinRequests").get(input.request.joinRequestId); if (!raw || fromJoinRequestRecord(raw, input.request.joinRequestId).status !== "pending") throw new ApplicationError("CONFLICT", "Only a Pending join request may transition."); await tx.objectStore("joinRequests").put(toJoinRequestRecord(input.request)); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async transferLeadership(input: Parameters<AtomicApplicationPersistence["transferLeadership"]>[0]): Promise<void> {
    if (input.formerLeader.householdId !== input.newLeader.householdId || input.formerLeader.role !== "member" || input.newLeader.role !== "leader" || input.formerLeader.status !== "active" || input.newLeader.status !== "active") throw new ApplicationError("CONFLICT", "Leadership transfer must atomically swap two active member roles.");
    const tx = (await this.db()).transaction(["memberships", "auditEvents"], "readwrite");
    try {
      const formerKey = membershipKey(input.formerLeader.householdId, input.formerLeader.userId);
      const newKey = membershipKey(input.newLeader.householdId, input.newLeader.userId);
      const [formerRaw, newRaw] = await Promise.all([tx.objectStore("memberships").get(formerKey), tx.objectStore("memberships").get(newKey)]);
      if (!formerRaw || !newRaw || fromMembershipRecord(formerRaw, formerKey).role !== "leader" || fromMembershipRecord(newRaw, newKey).role !== "member") throw new ApplicationError("CONFLICT", "Persisted leadership no longer matches the requested transfer.");
      await tx.objectStore("memberships").put(toMembershipRecord(input.formerLeader));
      await tx.objectStore("memberships").put(toMembershipRecord(input.newLeader));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async endMembership(input: Parameters<AtomicApplicationPersistence["endMembership"]>[0]): Promise<void> {
    if (input.membership.status !== "former" || input.membership.role !== "member") throw new ApplicationError("CONFLICT", "Ended membership must retain a former-member record.");
    const tx = (await this.db()).transaction(["memberships", "auditEvents"], "readwrite");
    try { const key = membershipKey(input.membership.householdId, input.membership.userId); const raw = await tx.objectStore("memberships").get(key); if (!raw || fromMembershipRecord(raw, key).status !== "active") throw new ApplicationError("CONFLICT", "Only an active membership may end."); await tx.objectStore("memberships").put(toMembershipRecord(input.membership)); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async deleteHousehold(input: Parameters<AtomicApplicationPersistence["deleteHousehold"]>[0]): Promise<void> {
    if (!input.household.deletedAt) throw new ApplicationError("CONFLICT", "Household deletion requires a tombstone.");
    if (input.formerMemberships.some((membership) => membership.householdId !== input.household.householdId || membership.status !== "former")) throw new ApplicationError("CONFLICT", "Household deletion must retain every membership as former history.");
    const tx = (await this.db()).transaction(["households", "memberships", "auditEvents"], "readwrite");
    try {
      if (!(await tx.objectStore("households").getKey(input.household.householdId))) throw new ApplicationError("NOT_FOUND", "Household not found.");
      const existing = await tx.objectStore("memberships").index("householdId").getAll(input.household.householdId);
      if (existing.length !== input.formerMemberships.length) throw new ApplicationError("CONFLICT", "Household membership history changed before deletion.");
      await tx.objectStore("households").put(toHouseholdRecord(input.household));
      for (const membership of input.formerMemberships) await tx.objectStore("memberships").put(toMembershipRecord(membership));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async createExpense(input: Parameters<AtomicApplicationPersistence["createExpense"]>[0]): Promise<void> {
    const expense = toExpenseRecord(input.expense);
    const privateCard = input.privateCardSnapshot ? toPrivateCardRecord(input.privateCardSnapshot) : undefined;
    if ((input.expense.payment.method === "card") !== Boolean(privateCard)) throw new ApplicationError("CONFLICT", "Card expenses require exactly one private historical snapshot.");
    const receipts = input.receipts.map((item) => ({ metadata: toReceiptRecord(item.metadata), blob: receiptBlob(item.metadata, item.content) }));
    const tx = (await this.db()).transaction(["memberships", "expenses", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
    try {
      const membershipRaw = await tx.objectStore("memberships").get(
        membershipKey(input.expense.householdId, input.expense.creatorId),
      );
      if (
        !membershipRaw ||
        fromMembershipRecord(
          membershipRaw,
          membershipKey(input.expense.householdId, input.expense.creatorId),
        ).status !== "active"
      ) {
        throw new ApplicationError("CONFLICT", "Expense creator is no longer an active household member.");
      }
      for (const allocation of input.expense.allocations) {
        const participantKey = membershipKey(
          input.expense.householdId,
          allocation.participantId,
        );
        const participantRaw = await tx.objectStore("memberships").get(participantKey);
        if (
          !participantRaw ||
          fromMembershipRecord(participantRaw, participantKey).status !== "active"
        ) {
          throw new ApplicationError(
            "CONFLICT",
            "Expense participants changed before creation.",
          );
        }
      }
      await tx.objectStore("expenses").add(expense);
      if (privateCard) await tx.objectStore("expenseCardPrivateDetails").add(privateCard);
      for (const receipt of receipts) { await tx.objectStore("receiptMetadata").add(receipt.metadata); await tx.objectStore("receiptBlobs").add(receipt.blob); }
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async editExpense(input: Parameters<AtomicApplicationPersistence["editExpense"]>[0]): Promise<void> {
    const expenseRecord = toExpenseRecord(input.expense);
    const privateCardRecord = input.privateCardSnapshot
      ? toPrivateCardRecord(input.privateCardSnapshot)
      : undefined;
    const additions = (input.receiptAdditions ?? []).map((item) => ({
      metadata: toReceiptRecord(item.metadata),
      blob: receiptBlob(item.metadata, item.content),
    }));
    const removals = (input.receiptRemovals ?? []).map(toReceiptRecord);
    const audits = input.auditEvents.map(toAuditRecord);
    const tx = (await this.db()).transaction(["memberships", "expenses", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
    try {
      const currentRaw = await tx.objectStore("expenses").get(input.expense.expenseId);
      if (!currentRaw) throw new ApplicationError("NOT_FOUND", "Expense not found.");
      const current = fromExpenseRecord(currentRaw, input.expense.expenseId);
      if (current.updatedAt !== input.expectedUpdatedAt) {
        throw new ApplicationError("CONFLICT", "Expense changed before this edit could be saved.");
      }
      const actorId = input.auditEvents[0]?.actorId;
      if (!actorId || input.auditEvents.some((audit) => audit.actorId !== actorId)) {
        throw new ApplicationError("CONFLICT", "Expense edit audit actors must match.");
      }
      const membershipRecordKey = membershipKey(input.expense.householdId, actorId);
      const membershipRaw = await tx.objectStore("memberships").get(membershipRecordKey);
      if (!membershipRaw) throw new ApplicationError("CONFLICT", "Expense editor is no longer an active household member.");
      const membership = fromMembershipRecord(membershipRaw, membershipRecordKey);
      if (
        membership.status !== "active" ||
        (actorId !== current.creatorId && membership.role !== "leader")
      ) {
        throw new ApplicationError("CONFLICT", "Expense edit permission changed before save.");
      }
      const currentMembershipRecords = await tx
        .objectStore("memberships")
        .index("householdId")
        .getAll(input.expense.householdId);
      const currentMemberships = currentMembershipRecords.map((record) =>
        fromMembershipRecord(record, record.key),
      );
      assertLegacyPercentageChangeAllowed(
        expenseFingerprint(current),
        expenseFingerprint(input.expense),
      );
      assertFormerMemberChangeAllowed(
        expenseFingerprint(current),
        expenseFingerprint(input.expense),
        currentMemberships,
      );
      await tx.objectStore("expenses").put(expenseRecord);
      if (privateCardRecord) {
        await tx.objectStore("expenseCardPrivateDetails").put(privateCardRecord);
      }
      for (const addition of additions) {
        await tx.objectStore("receiptMetadata").add(addition.metadata);
        await tx.objectStore("receiptBlobs").add(addition.blob);
      }
      for (const removal of removals) {
        const currentReceipt = await tx.objectStore("receiptMetadata").get(removal.id);
        if (
          !currentReceipt ||
          currentReceipt.expenseId !== input.expense.expenseId ||
          currentReceipt.deletedAt
        ) {
          throw new ApplicationError("CONFLICT", "A staged receipt changed before save.");
        }
        await tx.objectStore("receiptMetadata").put(removal);
        await tx.objectStore("receiptBlobs").delete(removal.id);
      }
      for (const audit of audits) {
        await tx.objectStore("auditEvents").add(audit);
      }
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async createSettlement(input: Parameters<AtomicApplicationPersistence["createSettlement"]>[0]): Promise<void> {
    if (input.settlement.status !== "pending") throw new ApplicationError("CONFLICT", "New settlements must be Pending.");
    const tx = (await this.db()).transaction(["settlements", "auditEvents"], "readwrite");
    try { await tx.objectStore("settlements").add(toSettlementRecord(input.settlement)); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async transitionSettlement(input: Parameters<AtomicApplicationPersistence["transitionSettlement"]>[0]): Promise<void> {
    if (input.expectedStatus !== "pending" || input.settlement.status === "pending") throw new ApplicationError("CONFLICT", "Settlement transitions must start from Pending and become terminal.");
    const tx = (await this.db()).transaction(["settlements", "auditEvents"], "readwrite");
    try {
      const raw = await tx.objectStore("settlements").get(input.settlement.settlementId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
      const existing = fromSettlementRecord(raw, input.settlement.settlementId);
      if (existing.status === "confirmed") throw new DomainError("CONFIRMED_SETTLEMENT_IMMUTABLE", "A confirmed settlement is immutable financial history.");
      if (existing.status !== input.expectedStatus) throw new ApplicationError("CONFLICT", "Settlement status changed before transition.");
      assertSettlementIdentityUnchanged(existing, input.settlement);
      await tx.objectStore("settlements").put(toSettlementRecord(input.settlement));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async createCard(input: Parameters<AtomicApplicationPersistence["createCard"]>[0]): Promise<void> {
    if (input.card.archivedAt) throw new ApplicationError("CONFLICT", "A new card cannot be archived.");
    const tx = (await this.db()).transaction(["cards", "auditEvents"], "readwrite");
    try { await tx.objectStore("cards").add(toCardRecord(input.card)); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async updateCard(input: Parameters<AtomicApplicationPersistence["updateCard"]>[0]): Promise<void> {
    if (input.card.archivedAt) throw new ApplicationError("CONFLICT", "Archived cards cannot be edited.");
    const tx = (await this.db()).transaction(["cards", "auditEvents"], "readwrite");
    try { const raw = await tx.objectStore("cards").get(input.card.cardId); if (!raw || fromCardRecord(raw, input.card.cardId).ownerId !== input.card.ownerId) throw new ApplicationError("NOT_FOUND", "Card not found."); await tx.objectStore("cards").put(toCardRecord(input.card)); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async archiveCard(input: Parameters<AtomicApplicationPersistence["archiveCard"]>[0]): Promise<void> {
    if (!input.card.archivedAt) throw new ApplicationError("CONFLICT", "Archive operation requires an archived card.");
    const tx = (await this.db()).transaction(["cards", "auditEvents"], "readwrite");
    try { const raw = await tx.objectStore("cards").get(input.card.cardId); if (!raw || fromCardRecord(raw, input.card.cardId).ownerId !== input.card.ownerId) throw new ApplicationError("NOT_FOUND", "Card not found."); await tx.objectStore("cards").put(toCardRecord(input.card)); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async deleteCard(input: Parameters<AtomicApplicationPersistence["deleteCard"]>[0]): Promise<void> {
    const tx = (await this.db()).transaction(["cards", "expenseCardPrivateDetails", "auditEvents"], "readwrite");
    try { const raw = await tx.objectStore("cards").get(input.cardId); if (!raw || raw.ownerId !== input.ownerId) throw new ApplicationError("NOT_FOUND", "Card not found."); if (await tx.objectStore("expenseCardPrivateDetails").index("cardId").getKey(input.cardId)) throw new ApplicationError("CONFLICT", "Referenced cards must be archived instead of deleted."); await tx.objectStore("cards").delete(input.cardId); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async createReceipt(input: Parameters<AtomicApplicationPersistence["createReceipt"]>[0]): Promise<void> {
    if (input.metadata.deletedAt) throw new ApplicationError("CONFLICT", "A new receipt cannot be deleted.");
    const tx = (await this.db()).transaction(["receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
    try { await tx.objectStore("receiptMetadata").add(toReceiptRecord(input.metadata)); await tx.objectStore("receiptBlobs").add(receiptBlob(input.metadata, input.content)); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async deleteReceipt(input: Parameters<AtomicApplicationPersistence["deleteReceipt"]>[0]): Promise<void> {
    if (!input.metadata.deletedAt) throw new ApplicationError("CONFLICT", "Receipt deletion requires a tombstone.");
    const tx = (await this.db()).transaction(["receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
    try { if (!(await tx.objectStore("receiptMetadata").getKey(input.metadata.receiptId))) throw new ApplicationError("NOT_FOUND", "Receipt not found."); await tx.objectStore("receiptMetadata").put(toReceiptRecord(input.metadata)); await tx.objectStore("receiptBlobs").delete(input.metadata.receiptId); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }
}
