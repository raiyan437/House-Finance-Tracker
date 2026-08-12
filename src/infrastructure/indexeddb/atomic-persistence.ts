import { ApplicationError } from "@/application/errors/application-error";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { DomainError } from "@/domain/shared/domain-error";
import type { IDBPDatabase, IDBPTransaction, StoreNames } from "idb";
import {
  assertSettlementIdentityUnchanged,
  persistenceFailure,
  receiptBlob,
} from "./repositories";
import {
  fromCardRecord,
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
import { membershipKey } from "./keys";
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

export class IndexedDbAtomicApplicationPersistence implements AtomicApplicationPersistence {
  constructor(private readonly source: DatabaseSource) {}

  private async db(): Promise<IDBPDatabase<HouseFinanceDatabase>> { return this.source; }

  async createHousehold(input: Parameters<AtomicApplicationPersistence["createHousehold"]>[0]): Promise<void> {
    const household = toHouseholdRecord(input.household);
    const membership = toMembershipRecord(input.leaderMembership);
    const audit = toAuditRecord(input.auditEvent);
    const tx = (await this.db()).transaction(["households", "memberships", "auditEvents"], "readwrite");
    try {
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
    const tx = (await this.db()).transaction(["joinRequests", "auditEvents"], "readwrite");
    try { await tx.objectStore("joinRequests").add(request); await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent)); await tx.done; }
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
    const tx = (await this.db()).transaction(["expenses", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
    try {
      await tx.objectStore("expenses").add(expense);
      if (privateCard) await tx.objectStore("expenseCardPrivateDetails").add(privateCard);
      for (const receipt of receipts) { await tx.objectStore("receiptMetadata").add(receipt.metadata); await tx.objectStore("receiptBlobs").add(receipt.blob); }
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async editExpense(input: Parameters<AtomicApplicationPersistence["editExpense"]>[0]): Promise<void> {
    const tx = (await this.db()).transaction(["expenses", "expenseCardPrivateDetails", "auditEvents"], "readwrite");
    try {
      if (!(await tx.objectStore("expenses").getKey(input.expense.expenseId))) throw new ApplicationError("NOT_FOUND", "Expense not found.");
      await tx.objectStore("expenses").put(toExpenseRecord(input.expense));
      if (input.removePrivateCardSnapshot) await tx.objectStore("expenseCardPrivateDetails").delete(input.expense.expenseId);
      else if (input.privateCardSnapshot) await tx.objectStore("expenseCardPrivateDetails").put(toPrivateCardRecord(input.privateCardSnapshot));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
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
