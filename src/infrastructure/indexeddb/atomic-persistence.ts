import { ApplicationError } from "@/application/errors/application-error";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import { DomainError } from "@/domain/shared/domain-error";
import {
  evaluateHouseholdDeletionEligibility,
  leaveHousehold,
  removeHouseholdMember,
} from "@/domain/membership/membership-eligibility";
import { transferLeadership } from "@/domain/membership/leadership-policy";
import {
  assertFormerMemberChangeAllowed,
  assertLegacyPercentageChangeAllowed,
  type ExpenseFinancialFingerprint,
} from "@/domain/expenses/expense-financial-fingerprint";
import {
  toBalanceExpense,
  type AuditEvent,
  type Card,
  type Expense,
  type ExpenseCardPrivateSnapshot,
} from "@/domain/records/domain-records";
import { auditEventId } from "@/domain/shared/identifiers";
import { createPendingSettlement } from "@/domain/settlements/pending-settlement-policy";
import type { IDBPDatabase, IDBPTransaction, StoreNames } from "idb";
import {
  assertSettlementIdentityUnchanged,
  persistenceFailure,
  receiptBlob,
} from "./repositories";
import {
  fromCardRecord,
  fromExpenseRecord,
  fromHouseholdRecord,
  fromJoinRequestRecord,
  fromMembershipRecord,
  fromPrivateCardRecord,
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

function abortSafely<Stores extends StoreNames<HouseFinanceDatabase>[]>(
  transaction: IDBPTransaction<HouseFinanceDatabase, Stores, "readwrite">,
): void {
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

function cardSnapshot(expense: Expense, card: Card): ExpenseCardPrivateSnapshot {
  return {
    expenseId: expense.expenseId,
    ownerId: expense.creatorId,
    cardId: card.cardId,
    cardName: card.name,
    cardType: card.type,
    colorId: card.colorId,
  };
}

function householdStateChanged(message: string): ApplicationError {
  return new ApplicationError("HOUSEHOLD_STATE_CHANGED", message);
}

function assertAuditMatches(
  audit: AuditEvent,
  householdId: string,
  actorId: string,
): void {
  if (audit.householdId !== householdId || audit.actorId !== actorId) {
    throw new ApplicationError(
      "CONFLICT",
      "The household audit does not match the requested action.",
    );
  }
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
    const tx = (await this.db()).transaction(["households", "memberships", "joinRequests", "auditEvents"], "readwrite");
    try {
      const [householdRaw, activeMembership, pendingRequest] = await Promise.all([
        tx.objectStore("households").get(input.request.householdId),
        tx.objectStore("memberships").index("activeMembershipUserKey").getKey(activeMembershipUserKey(input.request.userId)),
        tx.objectStore("joinRequests").index("pendingJoinUserKey").getKey(pendingJoinUserKey(input.request.userId)),
      ]);
      if (
        !householdRaw ||
        fromHouseholdRecord(householdRaw, input.request.householdId).deletedAt
      ) {
        throw householdStateChanged(
          "The household is no longer active.",
        );
      }
      if (activeMembership) throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
      if (pendingRequest) throw new ApplicationError("CONFLICT", "The current user already has a Pending join request.");
      await tx.objectStore("joinRequests").add(request);
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async acceptJoinRequest(input: Parameters<AtomicApplicationPersistence["acceptJoinRequest"]>[0]): Promise<void> {
    const tx = (await this.db()).transaction(["households", "joinRequests", "memberships", "auditEvents"], "readwrite");
    try {
      const existingRaw = await tx.objectStore("joinRequests").get(input.joinRequestId);
      if (!existingRaw) throw householdStateChanged("The join request is no longer available.");
      const current = fromJoinRequestRecord(existingRaw, input.joinRequestId);
      if (current.status !== "pending") throw householdStateChanged("The join request is no longer Pending.");
      const householdRaw = await tx.objectStore("households").get(current.householdId);
      if (!householdRaw || fromHouseholdRecord(householdRaw, current.householdId).deletedAt) throw householdStateChanged("The household is no longer active.");
      const actorKey = membershipKey(current.householdId, input.actorId);
      const actorRaw = await tx.objectStore("memberships").get(actorKey);
      const actor = actorRaw ? fromMembershipRecord(actorRaw, actorKey) : undefined;
      if (!actor || actor.status !== "active" || actor.role !== "leader") throw householdStateChanged("Household leadership changed before the request was resolved.");
      const activeMembership = await tx.objectStore("memberships").index("activeMembershipUserKey").getKey(activeMembershipUserKey(current.userId));
      if (activeMembership) throw householdStateChanged("The requester already belongs to a household.");
      assertAuditMatches(input.auditEvent, current.householdId, input.actorId);
      await tx.objectStore("joinRequests").put(toJoinRequestRecord({ ...current, status: "accepted", resolvedAt: input.resolvedAt, resolvedByUserId: input.actorId }));
      await tx.objectStore("memberships").add(toMembershipRecord({ householdId: current.householdId, userId: current.userId, status: "active", role: "member" }));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async transitionJoinRequest(input: Parameters<AtomicApplicationPersistence["transitionJoinRequest"]>[0]): Promise<void> {
    if (input.status !== "rejected" && input.status !== "cancelled") {
      throw new ApplicationError(
        "CONFLICT",
        "Ordinary join-request actions cannot produce that terminal status.",
      );
    }
    const tx = (await this.db()).transaction(["households", "memberships", "joinRequests", "auditEvents"], "readwrite");
    try {
      const raw = await tx.objectStore("joinRequests").get(input.joinRequestId);
      if (!raw) throw householdStateChanged("The join request is no longer available.");
      const current = fromJoinRequestRecord(raw, input.joinRequestId);
      if (current.status !== "pending") throw householdStateChanged("The join request is no longer Pending.");
      const householdRaw = await tx.objectStore("households").get(current.householdId);
      if (!householdRaw || fromHouseholdRecord(householdRaw, current.householdId).deletedAt) throw householdStateChanged("The household is no longer active.");
      if (input.status === "cancelled") {
        if (current.userId !== input.actorId) throw householdStateChanged("Only the requester may cancel this request.");
      } else {
        const actorKey = membershipKey(current.householdId, input.actorId);
        const actorRaw = await tx.objectStore("memberships").get(actorKey);
        const actor = actorRaw ? fromMembershipRecord(actorRaw, actorKey) : undefined;
        if (!actor || actor.status !== "active" || actor.role !== "leader") throw householdStateChanged("Household leadership changed before the request was resolved.");
      }
      assertAuditMatches(input.auditEvent, current.householdId, input.actorId);
      await tx.objectStore("joinRequests").put(toJoinRequestRecord({ ...current, status: input.status, resolvedAt: input.resolvedAt, resolvedByUserId: input.actorId }));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async transferLeadership(input: Parameters<AtomicApplicationPersistence["transferLeadership"]>[0]): Promise<void> {
    assertAuditMatches(input.auditEvent, input.householdId, input.actorId);
    const tx = (await this.db()).transaction(["households", "memberships", "auditEvents"], "readwrite");
    try {
      const householdRaw = await tx.objectStore("households").get(input.householdId);
      if (!householdRaw || fromHouseholdRecord(householdRaw, input.householdId).deletedAt) throw householdStateChanged("The household is no longer active.");
      const rawMemberships = await tx.objectStore("memberships").index("householdId").getAll(input.householdId);
      const memberships = rawMemberships.map((raw) => fromMembershipRecord(raw, raw.key));
      let result;
      try {
        result = transferLeadership(input.householdId, input.actorId, input.targetId, memberships);
      } catch (error) {
        if (error instanceof DomainError) throw householdStateChanged("Household leadership or membership changed before confirmation.");
        throw error;
      }
      await tx.objectStore("memberships").put(toMembershipRecord(result.find((membership) => membership.userId === input.actorId)!));
      await tx.objectStore("memberships").put(toMembershipRecord(result.find((membership) => membership.userId === input.targetId)!));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async leaveHousehold(input: Parameters<AtomicApplicationPersistence["leaveHousehold"]>[0]): Promise<void> {
    assertAuditMatches(input.auditEvent, input.householdId, input.actorId);
    const tx = (await this.db()).transaction(["households", "memberships", "expenses", "settlements", "auditEvents"], "readwrite");
    try {
      const householdRaw = await tx.objectStore("households").get(input.householdId);
      if (!householdRaw || fromHouseholdRecord(householdRaw, input.householdId).deletedAt) throw householdStateChanged("The household is no longer active.");
      const [membershipRecords, expenseRecords, settlementRecords] = await Promise.all([
        tx.objectStore("memberships").index("householdId").getAll(input.householdId),
        tx.objectStore("expenses").index("householdId").getAll(input.householdId),
        tx.objectStore("settlements").index("householdId").getAll(input.householdId),
      ]);
      const memberships = membershipRecords.map((raw) => fromMembershipRecord(raw, raw.key));
      const expenses = expenseRecords.map((raw) => fromExpenseRecord(raw, raw.id));
      const settlements = settlementRecords.map((raw) => fromSettlementRecord(raw, raw.id));
      const sheet = calculateHouseholdBalances(input.householdId, memberships, expenses.map(toBalanceExpense), settlements);
      let result;
      try {
        result = leaveHousehold(input.householdId, input.actorId, memberships, sheet, settlements);
      } catch (error) {
        if (error instanceof DomainError) throw householdStateChanged("Leave eligibility changed before confirmation.");
        throw error;
      }
      await tx.objectStore("memberships").put(toMembershipRecord(result.find((membership) => membership.userId === input.actorId)!));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async removeHouseholdMember(input: Parameters<AtomicApplicationPersistence["removeHouseholdMember"]>[0]): Promise<void> {
    assertAuditMatches(input.auditEvent, input.householdId, input.actorId);
    const tx = (await this.db()).transaction(["households", "memberships", "expenses", "settlements", "auditEvents"], "readwrite");
    try {
      const householdRaw = await tx.objectStore("households").get(input.householdId);
      if (!householdRaw || fromHouseholdRecord(householdRaw, input.householdId).deletedAt) throw householdStateChanged("The household is no longer active.");
      const [membershipRecords, expenseRecords, settlementRecords] = await Promise.all([
        tx.objectStore("memberships").index("householdId").getAll(input.householdId),
        tx.objectStore("expenses").index("householdId").getAll(input.householdId),
        tx.objectStore("settlements").index("householdId").getAll(input.householdId),
      ]);
      const memberships = membershipRecords.map((raw) => fromMembershipRecord(raw, raw.key));
      const expenses = expenseRecords.map((raw) => fromExpenseRecord(raw, raw.id));
      const settlements = settlementRecords.map((raw) => fromSettlementRecord(raw, raw.id));
      const sheet = calculateHouseholdBalances(input.householdId, memberships, expenses.map(toBalanceExpense), settlements);
      let result;
      try {
        result = removeHouseholdMember(input.householdId, input.actorId, input.targetId, memberships, sheet, settlements);
      } catch (error) {
        if (error instanceof DomainError) throw householdStateChanged("Member removal eligibility changed before confirmation.");
        throw error;
      }
      await tx.objectStore("memberships").put(toMembershipRecord(result.find((membership) => membership.userId === input.targetId)!));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async deleteHousehold(input: Parameters<AtomicApplicationPersistence["deleteHousehold"]>[0]): Promise<void> {
    assertAuditMatches(input.auditEvent, input.householdId, input.actorId);
    const tx = (await this.db()).transaction(["households", "memberships", "joinRequests", "expenses", "settlements", "auditEvents"], "readwrite");
    try {
      const householdRaw = await tx.objectStore("households").get(input.householdId);
      if (!householdRaw) throw householdStateChanged("The household is no longer available.");
      const household = fromHouseholdRecord(householdRaw, input.householdId);
      if (household.deletedAt) throw householdStateChanged("The household is already closed.");
      const [membershipRecords, joinRequestRecords, expenseRecords, settlementRecords] = await Promise.all([
        tx.objectStore("memberships").index("householdId").getAll(input.householdId),
        tx.objectStore("joinRequests").index("householdId").getAll(input.householdId),
        tx.objectStore("expenses").index("householdId").getAll(input.householdId),
        tx.objectStore("settlements").index("householdId").getAll(input.householdId),
      ]);
      const memberships = membershipRecords.map((raw) => fromMembershipRecord(raw, raw.key));
      const requests = joinRequestRecords.map((raw) => fromJoinRequestRecord(raw, raw.id));
      const expenses = expenseRecords.map((raw) => fromExpenseRecord(raw, raw.id));
      const settlements = settlementRecords.map((raw) => fromSettlementRecord(raw, raw.id));
      const sheet = calculateHouseholdBalances(input.householdId, memberships, expenses.map(toBalanceExpense), settlements);
      const eligibility = evaluateHouseholdDeletionEligibility(input.householdId, input.actorId, memberships, sheet, settlements);
      if (!eligibility.eligible) throw householdStateChanged("Household deletion eligibility changed before confirmation.");
      await tx.objectStore("households").put(toHouseholdRecord({ ...household, updatedAt: input.auditEvent.occurredAt, deletedAt: input.auditEvent.occurredAt, deletedByUserId: input.actorId }));
      for (const membership of memberships) {
        await tx.objectStore("memberships").put(toMembershipRecord({ ...membership, status: "former" }));
      }
      for (const request of requests.filter((item) => item.status === "pending")) {
        await tx.objectStore("joinRequests").put(toJoinRequestRecord({ ...request, status: "household-closed", resolvedAt: input.auditEvent.occurredAt, resolvedByUserId: input.actorId }));
        await tx.objectStore("auditEvents").add(toAuditRecord({
          auditEventId: auditEventId(`${input.joinRequestAuditIdBase}:${request.joinRequestId}`),
          householdId: input.householdId,
          actorId: input.actorId,
          aggregateType: "join-request",
          aggregateId: request.joinRequestId,
          action: "household-closed",
          occurredAt: input.auditEvent.occurredAt,
          changedFields: ["status"],
        }));
      }
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async createExpense(input: Parameters<AtomicApplicationPersistence["createExpense"]>[0]): Promise<void> {
    const expense = toExpenseRecord(input.expense);
    if ((input.expense.payment.method === "card") !== Boolean(input.selectedCardId)) throw new ApplicationError("CONFLICT", "Card expenses require exactly one selected Card.");
    const receipts = input.receipts.map((item) => ({ metadata: toReceiptRecord(item.metadata), blob: receiptBlob(item.metadata, item.content) }));
    const tx = (await this.db()).transaction(["memberships", "cards", "expenses", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
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
      let privateCard;
      if (input.selectedCardId) {
        const cardRaw = await tx.objectStore("cards").get(input.selectedCardId);
        if (!cardRaw) throw new ApplicationError("CONFLICT", "The selected Card changed. Refresh and try again.");
        const selectedCard = fromCardRecord(cardRaw, input.selectedCardId);
        if (selectedCard.ownerId !== input.expense.creatorId || selectedCard.archivedAt) {
          throw new ApplicationError("CONFLICT", "The selected Card is no longer available. Refresh and try again.");
        }
        privateCard = toPrivateCardRecord(cardSnapshot(input.expense, selectedCard));
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
    const additions = (input.receiptAdditions ?? []).map((item) => ({
      metadata: toReceiptRecord(item.metadata),
      blob: receiptBlob(item.metadata, item.content),
    }));
    const removals = (input.receiptRemovals ?? []).map(toReceiptRecord);
    const audits = input.auditEvents.map(toAuditRecord);
    const tx = (await this.db()).transaction(["memberships", "cards", "expenses", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
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
      let privateCardRecord;
      if (input.selectedCardId) {
        if (actorId !== current.creatorId || input.expense.payment.method !== "card") {
          throw new ApplicationError("CONFLICT", "Only the Expense owner may select a Card.");
        }
        const cardRaw = await tx.objectStore("cards").get(input.selectedCardId);
        if (!cardRaw) throw new ApplicationError("CONFLICT", "The selected Card changed. Refresh and try again.");
        const selectedCard = fromCardRecord(cardRaw, input.selectedCardId);
        if (selectedCard.ownerId !== current.creatorId || selectedCard.archivedAt) {
          throw new ApplicationError("CONFLICT", "The selected Card is no longer available. Refresh and try again.");
        }
        privateCardRecord = toPrivateCardRecord(cardSnapshot(input.expense, selectedCard));
      } else if (input.expense.payment.method === "card") {
        if (current.payment.method !== "card") {
          throw new ApplicationError("CONFLICT", "A new Card association requires an active selected Card.");
        }
        const existingPrivate = await tx.objectStore("expenseCardPrivateDetails").get(input.expense.expenseId);
        if (!existingPrivate) throw new ApplicationError("CONFLICT", "Card expense history is unavailable.");
        const snapshot = fromPrivateCardRecord(existingPrivate, input.expense.expenseId);
        if (snapshot.ownerId !== current.creatorId) {
          throw new ApplicationError("CONFLICT", "Card expense history is inconsistent.");
        }
      }
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
    if (
      input.auditEvent.householdId !== input.settlement.householdId ||
      input.auditEvent.actorId !== input.settlement.senderId ||
      input.auditEvent.aggregateType !== "settlement" ||
      input.auditEvent.aggregateId !== input.settlement.settlementId
    ) {
      throw new ApplicationError("CONFLICT", "Settlement creation audit context is inconsistent.");
    }
    const tx = (await this.db()).transaction(
      ["memberships", "expenses", "settlements", "auditEvents"],
      "readwrite",
    );
    try {
      const [membershipRows, expenseRows, settlementRows] = await Promise.all([
        tx.objectStore("memberships").index("householdId").getAll(input.settlement.householdId),
        tx.objectStore("expenses").index("householdId").getAll(input.settlement.householdId),
        tx.objectStore("settlements").index("householdId").getAll(input.settlement.householdId),
      ]);
      const memberships = membershipRows.map((row) => fromMembershipRecord(row, row.key));
      const expenses = expenseRows.map((row) => fromExpenseRecord(row, row.id));
      const settlements = settlementRows.map((row) => fromSettlementRecord(row, row.id));
      const sheet = calculateHouseholdBalances(
        input.settlement.householdId,
        memberships,
        expenses.map(toBalanceExpense),
        settlements,
      );
      const revalidated = createPendingSettlement({
        settlementId: input.settlement.settlementId,
        householdId: input.settlement.householdId,
        actorId: input.auditEvent.actorId,
        requestedRecommendation: input.settlement.originatingRecommendation,
        createdAt: input.settlement.createdAt,
        memberships,
        currentRecommendations: generateSettlementRecommendations(sheet),
        existingSettlements: settlements,
      });
      assertSettlementIdentityUnchanged(revalidated, input.settlement);
      await tx.objectStore("settlements").add(toSettlementRecord(revalidated));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) {
      abortSafely(tx);
      if (error instanceof DomainError) {
        if (
          error.code === "SETTLEMENT_NOT_RECOMMENDED" ||
          error.code === "SETTLEMENT_AMOUNT_MISMATCH"
        ) {
          throw new ApplicationError(
            "CONFLICT",
            "Settlement recommendation changed. Refresh and try again.",
          );
        }
        if (error.code === "DUPLICATE_PENDING_SETTLEMENT") {
          throw new ApplicationError(
            "CONFLICT",
            "A Pending payment already exists between these members.",
          );
        }
      }
      persistenceFailure(error);
    }
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
    const tx = (await this.db()).transaction("cards", "readwrite");
    try { await tx.store.add(toCardRecord(input.card)); await tx.done; }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async updateCard(input: Parameters<AtomicApplicationPersistence["updateCard"]>[0]): Promise<void> {
    if (input.card.archivedAt) throw new ApplicationError("CONFLICT", "Archived cards cannot be edited.");
    const tx = (await this.db()).transaction("cards", "readwrite");
    try {
      const raw = await tx.store.get(input.card.cardId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Card not found.");
      const current = fromCardRecord(raw, input.card.cardId);
      if (current.ownerId !== input.card.ownerId) throw new ApplicationError("NOT_FOUND", "Card not found.");
      if (current.archivedAt) throw new ApplicationError("NOT_FOUND", "Card not found.");
      if (current.updatedAt !== input.expectedUpdatedAt) throw new ApplicationError("CONFLICT", "Card changed before this edit could be saved.");
      if (current.createdAt !== input.card.createdAt) throw new ApplicationError("CONFLICT", "Card identity metadata cannot be changed.");
      await tx.store.put(toCardRecord(input.card));
      await tx.done;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async removeCard(input: Parameters<AtomicApplicationPersistence["removeCard"]>[0]) {
    const tx = (await this.db()).transaction(["cards", "expenseCardPrivateDetails"], "readwrite");
    try {
      const raw = await tx.objectStore("cards").get(input.cardId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Card not found.");
      const current = fromCardRecord(raw, input.cardId);
      if (current.ownerId !== input.ownerId || current.archivedAt) {
        throw new ApplicationError("NOT_FOUND", "Card not found.");
      }
      const referenced = Boolean(
        await tx.objectStore("expenseCardPrivateDetails").index("cardId").getKey(input.cardId),
      );
      const actualAction = referenced ? "archive" as const : "delete" as const;
      if (actualAction !== input.expectedAction) {
        throw new ApplicationError(
          "CONFLICT",
          "Card usage changed. Refresh and confirm the updated action.",
        );
      }
      if (actualAction === "archive") {
        await tx.objectStore("cards").put(toCardRecord({
          ...current,
          updatedAt: input.occurredAt,
          archivedAt: input.occurredAt,
        }));
      } else {
        await tx.objectStore("cards").delete(input.cardId);
      }
      await tx.done;
      return actualAction === "archive" ? "archived" as const : "deleted" as const;
    } catch (error) {
      abortSafely(tx);
      persistenceFailure(error);
    }
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
