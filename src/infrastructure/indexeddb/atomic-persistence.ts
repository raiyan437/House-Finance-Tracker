import { ApplicationError } from "@/application/errors/application-error";
import { BackdatedExpenseConfirmationRequiredError } from "@/application/errors/application-error";
import { expenseRelevantIntentDigest, localBackdatedConfirmationToken } from "@/application/expenses/backdated-expense-confirmation";
import { assertIdempotentIntent, commandOutcomeKey } from "@/application/idempotency/command-idempotency";
import { assertReceiptAdmission, DEFAULT_RECEIPT_STORAGE_POLICY, type ReceiptStoragePolicy } from "@/application/receipts/receipt-storage-policy";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { assertHouseholdFinancialState } from "@/domain/balances/household-financial-state";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import { assertExpenseDateNotInFuture } from "@/domain/dates/business-calendar";
import { isBackdatedAfterSettlement, latestConfirmedSettlementBefore } from "@/domain/expenses/backdated-expense-policy";
import {
  assertConfirmedSettlementFinancialChangeAllowed,
  latestConfirmedSettlementAt,
} from "@/domain/expenses/confirmed-settlement-financial-lock";
import { DomainError } from "@/domain/shared/domain-error";
import { assertCanEditExpense, getExpensePermissions } from "@/domain/permissions/expense-permissions";
import {
  evaluateHouseholdDeletionEligibility,
  leaveHousehold,
  removeHouseholdMember,
} from "@/domain/membership/membership-eligibility";
import { transferLeadership } from "@/domain/membership/leadership-policy";
import {
  assertFormerMemberChangeAllowed,
  assertLegacyPercentageChangeAllowed,
  expenseFinancialFingerprintsEqual,
  type ExpenseFinancialFingerprint,
} from "@/domain/expenses/expense-financial-fingerprint";
import {
  assertHousehold,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  toBalanceExpense,
  type AuditEvent,
  type Card,
  type Expense,
  type ExpenseCardPrivateSnapshot,
  type Household,
} from "@/domain/records/domain-records";
import { auditEventId, commandId } from "@/domain/shared/identifiers";
import { createPendingSettlement } from "@/domain/settlements/pending-settlement-policy";
import type { IDBPDatabase, IDBPTransaction, StoreNames } from "idb";
import {
  assertSettlementIdentityUnchanged,
  persistenceFailure,
  receiptBlob,
} from "./repositories";
import {
  fromCardRecord,
  fromCommandOutcomeRecord,
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
  toCommandOutcomeRecord,
  toExpenseRecord,
  toHouseholdRecord,
  toJoinRequestRecord,
  toMembershipRecord,
  toPrivateCardRecord,
  toProfileRecord,
  toReceiptRecord,
  toSettlementRecord,
} from "./mappers";
import {
  activeMembershipUserKey,
  membershipKey,
  pendingJoinUserKey,
} from "./keys";
import type { HouseFinanceDatabase } from "./records";
import type { DatabaseSource } from "./database";


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

function expenseFingerprint(
  expense: Expense,
  cardAssociationIdentity?: string,
): ExpenseFinancialFingerprint {
  return {
    householdId: expense.householdId,
    amount: expense.amount,
    payerId: expense.payerId,
    splitMethod: expense.splitMethod,
    percentageEntries: expense.percentageEntries,
    allocations: expense.allocations,
    expenseDate: expense.expenseDate,
    payment: expense.payment,
    ...(expense.payment.method === "card"
      ? { cardAssociationIdentity }
      : {}),
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
  constructor(
    private readonly source: DatabaseSource,
    private readonly receiptStoragePolicy: ReceiptStoragePolicy = DEFAULT_RECEIPT_STORAGE_POLICY,
  ) {}

  private async db(): Promise<IDBPDatabase<HouseFinanceDatabase>> { return this.source; }

  async createHousehold(input: Parameters<AtomicApplicationPersistence["createHousehold"]>[0]): Promise<string> {
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
    if (input.idempotency.actorId !== input.leaderMembership.userId || input.idempotency.commandType !== "create-household") throw new ApplicationError("CONFLICT", "Household command identity is inconsistent.");
    const tx = (await this.db()).transaction(["households", "memberships", "joinRequests", "auditEvents", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) {
        const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey);
        assertIdempotentIntent(existing, input.idempotency);
        await tx.done;
        return existing.resourceId;
      }
      const [activeMembership, pendingRequest] = await Promise.all([
        tx.objectStore("memberships").index("activeMembershipUserKey").getKey(activeMembershipUserKey(input.leaderMembership.userId)),
        tx.objectStore("joinRequests").index("pendingJoinUserKey").getKey(pendingJoinUserKey(input.leaderMembership.userId)),
      ]);
      if (activeMembership) throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
      if (pendingRequest) throw new ApplicationError("CONFLICT", "Cancel the current Pending join request first.");
      await tx.objectStore("households").add(household);
      await tx.objectStore("memberships").add(membership);
      await tx.objectStore("auditEvents").add(audit);
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.household.householdId, completedAt: input.auditEvent.occurredAt }));
      await tx.done;
      return input.household.householdId;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async updateCurrentProfile(input: Parameters<AtomicApplicationPersistence["updateCurrentProfile"]>[0]): Promise<void> {
    if (input.displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      throw new ApplicationError("INVALID_INPUT", "Display name must be 20 characters or fewer.");
    }
    if (input.idempotency.actorId !== input.actorId || input.idempotency.commandType !== "update-profile-display-name") {
      throw new ApplicationError("CONFLICT", "Profile command identity is inconsistent.");
    }
    const tx = (await this.db()).transaction(["userProfiles", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingOutcome = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingOutcome) {
        assertIdempotentIntent(fromCommandOutcomeRecord(existingOutcome, outcomeKey), input.idempotency);
        await tx.done;
        return;
      }
      const raw = await tx.objectStore("userProfiles").get(input.actorId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Profile not found.");
      const current = fromProfileRecord(raw, input.actorId);
      if (current.displayName === input.displayName) {
        await tx.done;
        return;
      }
      if (current.version !== input.expectedVersion) {
        throw new ApplicationError("PROFILE_VERSION_CONFLICT", "This Profile changed while you were editing it.");
      }
      const updated = { ...current, displayName: input.displayName, version: current.version + 1, updatedAt: input.occurredAt };
      await tx.objectStore("userProfiles").put(toProfileRecord(updated));
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({
        ...input.idempotency,
        resourceId: String(input.actorId),
        completedAt: input.occurredAt,
      }));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async renameHousehold(input: Parameters<AtomicApplicationPersistence["renameHousehold"]>[0]): Promise<void> {
    if (input.name.trim() !== input.name || input.name.length === 0) {
      throw new ApplicationError("CONFLICT", "The House name must be non-empty and trimmed.");
    }
    const tx = (await this.db()).transaction(["households", "memberships", "auditEvents"], "readwrite");
    try {
      const raw = await tx.objectStore("households").get(input.householdId);
      if (!raw || raw.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
      const current = fromHouseholdRecord(raw, input.householdId);
      if (current.name === input.name) {
        await tx.done;
        return;
      }
      const leaderKey = await tx.objectStore("memberships").index("activeMembershipUserKey").getKey(activeMembershipUserKey(input.actorId));
      if (!leaderKey) throw new ApplicationError("NOT_FOUND", "Household not found.");
      const membershipRaw = await tx.objectStore("memberships").get(leaderKey);
      const membership = fromMembershipRecord(membershipRaw, leaderKey);
      if (
        membership.householdId !== input.householdId ||
        membership.role !== "leader" ||
        input.auditEvent.actorId !== input.actorId ||
        input.auditEvent.aggregateType !== "household" ||
        input.auditEvent.aggregateId !== input.householdId ||
        input.auditEvent.action !== "renamed"
      ) {
        throw new ApplicationError("NOT_FOUND", "Household not found.");
      }
      const updated: Household = { ...current, name: input.name, updatedAt: input.occurredAt };
      assertHousehold(updated);
      await tx.objectStore("households").put(toHouseholdRecord(updated));
      await tx.objectStore("auditEvents").add(toAuditRecord({ ...input.auditEvent, occurredAt: input.occurredAt }));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async createJoinRequest(input: Parameters<AtomicApplicationPersistence["createJoinRequest"]>[0]): Promise<string> {
    const request = toJoinRequestRecord(input.request);
    if (input.request.status !== "pending") throw new ApplicationError("CONFLICT", "New join requests must be Pending.");
    if (input.idempotency.actorId !== input.request.userId || input.idempotency.commandType !== "send-join-request") throw new ApplicationError("CONFLICT", "Join-request command identity is inconsistent.");
    const tx = (await this.db()).transaction(["households", "memberships", "joinRequests", "auditEvents", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) {
        const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey);
        assertIdempotentIntent(existing, input.idempotency);
        await tx.done;
        return existing.resourceId;
      }
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
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.request.joinRequestId, completedAt: input.auditEvent.occurredAt }));
      await tx.done;
      return input.request.joinRequestId;
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

  async createExpense(input: Parameters<AtomicApplicationPersistence["createExpense"]>[0]): Promise<string> {
    const expense = toExpenseRecord(input.expense);
    const actorId = input.actorId ?? input.expense.creatorId;
    const activeCommandId = input.commandId ?? commandId(`local-create:${input.expense.expenseId}`);
    assertExpenseDateNotInFuture(input.expense.expenseDate, input.expense.createdAt);
    if (input.expense.revision !== 1 || input.expense.updatedAt !== input.expense.createdAt || input.auditEvent.occurredAt !== input.expense.createdAt) {
      throw new ApplicationError("CONFLICT", "New Expense lifecycle metadata is inconsistent.");
    }
    if ((input.expense.payment.method === "card") !== Boolean(input.selectedCardId)) throw new ApplicationError("CONFLICT", "Card expenses require exactly one selected Card.");
    if (actorId !== input.expense.creatorId || input.auditEvent.actorId !== actorId) throw new ApplicationError("CONFLICT", "Expense command actor is inconsistent.");
    if (input.idempotency.actorId !== actorId || input.idempotency.commandType !== "create-expense" || input.idempotency.commandId !== activeCommandId) throw new ApplicationError("CONFLICT", "Expense idempotency identity is inconsistent.");
    const recomputedIntentDigest = expenseRelevantIntentDigest({
      amount: input.expense.amount,
      expenseDate: input.expense.expenseDate,
      splitMethod: input.expense.splitMethod,
      percentageEntries: input.expense.percentageEntries,
      allocations: input.expense.allocations,
      paymentMethod: input.expense.payment.method,
      ...(input.selectedCardId ? { cardAssociationIdentity: input.selectedCardId } : {}),
    });
    if (input.relevantIntentDigest !== undefined && input.relevantIntentDigest !== recomputedIntentDigest) throw new ApplicationError("CONFLICT", "Expense confirmation intent is inconsistent.");
    const receipts = input.receipts.map((item) => ({ metadata: toReceiptRecord(item.metadata), blob: receiptBlob(item.metadata, item.content) }));
    const tx = (await this.db()).transaction(["memberships", "cards", "expenses", "settlements", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "auditEvents", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) {
        const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey);
        assertIdempotentIntent(existing, input.idempotency);
        await tx.done;
        return existing.resourceId;
      }
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
      const [membershipRows, expenseRows, settlementRows] = await Promise.all([
        tx.objectStore("memberships").index("householdId").getAll(input.expense.householdId),
        tx.objectStore("expenses").index("householdId").getAll(input.expense.householdId),
        tx.objectStore("settlements").index("householdId").getAll(input.expense.householdId),
      ]);
      const allReceiptRows = await tx.objectStore("receiptMetadata").getAll();
      const projectedReceipts = allReceiptRows.map((row) => fromReceiptRecord(row, row.id));
      for (const receipt of input.receipts) {
        const available = projectedReceipts.filter((item) => item.contentStatus === "available");
        assertReceiptAdmission({
          expenseAvailableCount: available.filter((item) => item.expenseId === input.expense.expenseId).length,
          uploaderAvailableBytes: available.filter((item) => item.createdByUserId === input.expense.creatorId).reduce((total, item) => total + item.sizeBytes, 0),
          projectAvailableBytes: available.reduce((total, item) => total + item.sizeBytes, 0),
        }, receipt.metadata.sizeBytes, this.receiptStoragePolicy);
        projectedReceipts.push(receipt.metadata);
      }
      assertHouseholdFinancialState(
        input.expense.householdId,
        membershipRows.map((row) => fromMembershipRecord(row, row.key)),
        [...expenseRows.map((row) => fromExpenseRecord(row, row.id)), input.expense],
        settlementRows.map((row) => fromSettlementRecord(row, row.id)),
      );
      const settlements = settlementRows.map((row) => fromSettlementRecord(row, row.id));
      const boundary = latestConfirmedSettlementBefore(input.expense.householdId, input.expense.createdAt, settlements);
      if (isBackdatedAfterSettlement(input.expense.expenseDate, boundary)) {
        const token = localBackdatedConfirmationToken({
          actorId,
          commandType: "create-expense",
          commandId: activeCommandId,
          relevantIntentDigest: recomputedIntentDigest,
          proposedExpenseDate: input.expense.expenseDate,
          qualifyingSettlementId: boundary!.settlementId,
          qualifyingSettlementResolvedAt: boundary!.resolvedAt,
        });
        if (input.backdatedConfirmationToken !== token) throw new BackdatedExpenseConfirmationRequiredError(token);
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
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.expense.expenseId, completedAt: input.auditEvent.occurredAt }));
      await tx.done;
      return input.expense.expenseId;
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
    const tx = (await this.db()).transaction(["memberships", "cards", "expenses", "settlements", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
    try {
      const currentRaw = await tx.objectStore("expenses").get(input.expectedExpenseId);
      if (!currentRaw) throw new ApplicationError("NOT_FOUND", "Expense not found.");
      const current = fromExpenseRecord(currentRaw, input.expectedExpenseId);
      if (current.revision !== input.expectedRevision) {
        throw new ApplicationError("EXPENSE_VERSION_CONFLICT", "This expense changed while you were editing it.");
      }
      if (input.expense.revision !== current.revision + 1) {
        throw new ApplicationError("CONFLICT", "Expense revision must advance exactly once.");
      }
      if (
        input.expense.expenseId !== current.expenseId ||
        input.expense.householdId !== current.householdId ||
        input.expense.creatorId !== current.creatorId ||
        input.expense.createdAt !== current.createdAt
      ) {
        throw new ApplicationError(
          "CONFLICT",
          "Expense identity and creation history cannot be changed.",
        );
      }
      const actorId = input.auditEvents[0]?.actorId;
      if (!actorId || input.auditEvents.some((audit) => audit.actorId !== actorId)) {
        throw new ApplicationError("CONFLICT", "Expense edit audit actors must match.");
      }
      const commandActorId = input.actorId ?? actorId;
      if (actorId !== commandActorId) throw new ApplicationError("CONFLICT", "Expense command actor is inconsistent.");
      if (
        input.auditEvents.some((audit) => audit.occurredAt !== input.expense.updatedAt)
      ) {
        throw new ApplicationError("CONFLICT", "Expense lifecycle timestamps must use one command instant.");
      }
      const membershipRecordKey = membershipKey(current.householdId, actorId);
      const membershipRaw = await tx.objectStore("memberships").get(membershipRecordKey);
      if (!membershipRaw) throw new ApplicationError("CONFLICT", "Expense editor is no longer an active household member.");
      const membership = fromMembershipRecord(membershipRaw, membershipRecordKey);
      if (
        membership.status !== "active" ||
        (actorId !== current.creatorId && membership.role !== "leader")
      ) {
        throw new ApplicationError("CONFLICT", "Expense edit permission changed before save.");
      }
      if ((additions.length > 0 || removals.length > 0) && actorId !== current.creatorId) {
        throw new ApplicationError("RECEIPT_PRIVATE_ACCESS_FORBIDDEN", "Only the Expense creator may manage Receipts.");
      }
      const currentMembershipRecords = await tx
        .objectStore("memberships")
        .index("householdId")
        .getAll(current.householdId);
      const currentMemberships = currentMembershipRecords.map((record) =>
        fromMembershipRecord(record, record.key),
      );
      const [expenseRows, settlementRows] = await Promise.all([
        tx.objectStore("expenses").index("householdId").getAll(current.householdId),
        tx.objectStore("settlements").index("householdId").getAll(current.householdId),
      ]);
      const allReceiptRows = await tx.objectStore("receiptMetadata").getAll();
      const removalIds = new Set(removals.map((item) => item.id));
      const projectedReceipts = allReceiptRows
        .map((row) => fromReceiptRecord(row, row.id))
        .filter((item) => item.contentStatus !== "available" || !removalIds.has(item.receiptId));
      for (const addition of input.receiptAdditions ?? []) {
        const available = projectedReceipts.filter((item) => item.contentStatus === "available");
        assertReceiptAdmission({
          expenseAvailableCount: available.filter((item) => item.expenseId === current.expenseId).length,
          uploaderAvailableBytes: available.filter((item) => item.createdByUserId === actorId).reduce((total, item) => total + item.sizeBytes, 0),
          projectAvailableBytes: available.reduce((total, item) => total + item.sizeBytes, 0),
        }, addition.metadata.sizeBytes, this.receiptStoragePolicy);
        projectedReceipts.push(addition.metadata);
      }

      let currentCardAssociationIdentity: string | undefined;
      if (current.payment.method === "card") {
        const existingPrivate = await tx
          .objectStore("expenseCardPrivateDetails")
          .get(current.expenseId);
        if (!existingPrivate) {
          throw new ApplicationError(
            "CONFLICT",
            "Card expense history is unavailable.",
          );
        }
        const snapshot = fromPrivateCardRecord(
          existingPrivate,
          current.expenseId,
        );
        if (snapshot.ownerId !== current.creatorId) {
          throw new ApplicationError(
            "CONFLICT",
            "Card expense history is inconsistent.",
          );
        }
        currentCardAssociationIdentity = snapshot.cardId;
      }

      let privateCardRecord;
      let proposedCardAssociationIdentity: string | undefined;
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
        proposedCardAssociationIdentity = selectedCard.cardId;
        privateCardRecord = toPrivateCardRecord(cardSnapshot(input.expense, selectedCard));
      } else if (input.expense.payment.method === "card") {
        if (current.payment.method !== "card") {
          throw new ApplicationError("CONFLICT", "A new Card association requires an active selected Card.");
        }
        proposedCardAssociationIdentity = currentCardAssociationIdentity;
      }

      const currentFingerprint = expenseFingerprint(
        current,
        currentCardAssociationIdentity,
      );
      const proposedFingerprint = expenseFingerprint(
        input.expense,
        proposedCardAssociationIdentity,
      );
      const recomputedIntentDigest = expenseRelevantIntentDigest({
        amount: input.expense.amount,
        expenseDate: input.expense.expenseDate,
        splitMethod: input.expense.splitMethod,
        percentageEntries: input.expense.percentageEntries,
        allocations: input.expense.allocations,
        paymentMethod: input.expense.payment.method,
        ...(input.expense.payment.method === "card"
          ? { cardAssociationIdentity: commandActorId === current.creatorId ? proposedCardAssociationIdentity : "preserved-private-card" }
          : {}),
      });
      if (input.relevantIntentDigest !== undefined && input.relevantIntentDigest !== recomputedIntentDigest) throw new ApplicationError("CONFLICT", "Expense confirmation intent is inconsistent.");
      const settlements = settlementRows.map((row) =>
        fromSettlementRecord(row, row.id),
      );
      if (input.backdatedConfirmationApplicable && !expenseFinancialFingerprintsEqual(currentFingerprint, proposedFingerprint)) {
        const boundary = latestConfirmedSettlementBefore(current.householdId, input.expense.updatedAt, settlements);
        if (isBackdatedAfterSettlement(input.expense.expenseDate, boundary)) {
          const token = localBackdatedConfirmationToken({
            actorId: commandActorId,
            commandType: "edit-expense",
            commandId: input.commandId ?? commandId(`local-edit:${input.expectedExpenseId}:${input.expectedRevision}`),
            relevantIntentDigest: recomputedIntentDigest,
            proposedExpenseDate: input.expense.expenseDate,
            qualifyingSettlementId: boundary!.settlementId,
            qualifyingSettlementResolvedAt: boundary!.resolvedAt,
          });
          if (input.backdatedConfirmationToken !== token) throw new BackdatedExpenseConfirmationRequiredError(token);
        }
      }
      assertConfirmedSettlementFinancialChangeAllowed(
        currentFingerprint,
        proposedFingerprint,
        current.createdAt,
        latestConfirmedSettlementAt(current.householdId, settlements),
      );
      assertFormerMemberChangeAllowed(
        currentFingerprint,
        proposedFingerprint,
        currentMemberships,
      );
      assertLegacyPercentageChangeAllowed(
        currentFingerprint,
        proposedFingerprint,
      );
      if (!expenseFinancialFingerprintsEqual(currentFingerprint, proposedFingerprint)) {
        assertExpenseDateNotInFuture(input.expense.expenseDate, input.expense.updatedAt);
      }
      assertHouseholdFinancialState(
        current.householdId,
        currentMemberships,
        expenseRows.map((row) => row.id === current.expenseId ? input.expense : fromExpenseRecord(row, row.id)),
        settlements,
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
          currentReceipt.contentStatus !== "available"
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

  async createSettlement(input: Parameters<AtomicApplicationPersistence["createSettlement"]>[0]): Promise<string> {
    if (input.settlement.status !== "pending") throw new ApplicationError("CONFLICT", "New settlements must be Pending.");
    if (
      input.auditEvent.householdId !== input.settlement.householdId ||
      input.auditEvent.actorId !== input.settlement.senderId ||
      input.auditEvent.aggregateType !== "settlement" ||
      input.auditEvent.aggregateId !== input.settlement.settlementId
    ) {
      throw new ApplicationError("CONFLICT", "Settlement creation audit context is inconsistent.");
    }
    if (input.idempotency.actorId !== input.settlement.senderId || input.idempotency.commandType !== "create-pending-settlement") throw new ApplicationError("CONFLICT", "Settlement command identity is inconsistent.");
    const tx = (await this.db()).transaction(
      ["memberships", "expenses", "settlements", "auditEvents", "commandOutcomes"],
      "readwrite",
    );
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) {
        const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey);
        assertIdempotentIntent(existing, input.idempotency);
        await tx.done;
        return existing.resourceId;
      }
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
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.settlement.settlementId, completedAt: input.auditEvent.occurredAt }));
      await tx.done;
      return input.settlement.settlementId;
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
    const tx = (await this.db()).transaction(["memberships", "expenses", "settlements", "auditEvents"], "readwrite");
    try {
      const raw = await tx.objectStore("settlements").get(input.settlement.settlementId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
      const existing = fromSettlementRecord(raw, input.settlement.settlementId);
      if (existing.status === "confirmed") throw new DomainError("CONFIRMED_SETTLEMENT_IMMUTABLE", "A confirmed settlement is immutable financial history.");
      if (existing.status !== input.expectedStatus) throw new ApplicationError("CONFLICT", "Settlement status changed before transition.");
      assertSettlementIdentityUnchanged(existing, input.settlement);
      if (input.settlement.status === "confirmed") {
        const [membershipRows, expenseRows, settlementRows] = await Promise.all([
          tx.objectStore("memberships").index("householdId").getAll(input.settlement.householdId),
          tx.objectStore("expenses").index("householdId").getAll(input.settlement.householdId),
          tx.objectStore("settlements").index("householdId").getAll(input.settlement.householdId),
        ]);
        assertHouseholdFinancialState(
          input.settlement.householdId,
          membershipRows.map((row) => fromMembershipRecord(row, row.key)),
          expenseRows.map((row) => fromExpenseRecord(row, row.id)),
          settlementRows.map((row) => row.id === input.settlement.settlementId ? input.settlement : fromSettlementRecord(row, row.id)),
        );
      }
      await tx.objectStore("settlements").put(toSettlementRecord(input.settlement));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async createCard(input: Parameters<AtomicApplicationPersistence["createCard"]>[0]): Promise<string> {
    if (input.card.archivedAt) throw new ApplicationError("CONFLICT", "A new card cannot be archived.");
    if (input.idempotency.actorId !== input.card.ownerId || input.idempotency.commandType !== "create-card") throw new ApplicationError("CONFLICT", "Card command identity is inconsistent.");
    const tx = (await this.db()).transaction(["cards", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) { const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey); assertIdempotentIntent(existing, input.idempotency); await tx.done; return existing.resourceId; }
      await tx.objectStore("cards").add(toCardRecord(input.card));
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.card.cardId, completedAt: input.card.createdAt }));
      await tx.done;
      return input.card.cardId;
    }
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

  async createReceipt(input: Parameters<AtomicApplicationPersistence["createReceipt"]>[0]): Promise<string> {
    if (input.metadata.contentStatus !== "available") throw new ApplicationError("CONFLICT", "New receipt content must be available.");
    if (input.idempotency.actorId !== input.metadata.createdByUserId || input.idempotency.commandType !== "upload-receipt") throw new ApplicationError("CONFLICT", "Receipt command identity is inconsistent.");
    const tx = (await this.db()).transaction(["households", "memberships", "expenses", "receiptMetadata", "receiptBlobs", "auditEvents", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) { const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey); assertIdempotentIntent(existing, input.idempotency); await tx.done; return existing.resourceId; }
      assertAuditMatches(input.auditEvent, input.metadata.householdId, input.metadata.createdByUserId);
      const [householdRaw, expenseRaw, membershipRows] = await Promise.all([
        tx.objectStore("households").get(input.metadata.householdId),
        tx.objectStore("expenses").get(input.metadata.expenseId),
        tx.objectStore("memberships").index("householdId").getAll(input.metadata.householdId),
      ]);
      if (!householdRaw || fromHouseholdRecord(householdRaw, input.metadata.householdId).deletedAt) throw householdStateChanged("The household is no longer active.");
      if (!expenseRaw) throw new ApplicationError("CONFLICT", "The expense is no longer available.");
      const expense = fromExpenseRecord(expenseRaw, input.metadata.expenseId);
      if (expense.deletedAt || expense.householdId !== input.metadata.householdId) throw new ApplicationError("CONFLICT", "The expense is no longer available.");
      const memberships = membershipRows.map((row) => fromMembershipRecord(row, row.key));
      if (input.metadata.createdByUserId !== expense.creatorId) throw new ApplicationError("RECEIPT_PRIVATE_ACCESS_FORBIDDEN", "Only the Expense creator may add Receipts.");
      assertCanEditExpense(getExpensePermissions(input.metadata.householdId, input.metadata.createdByUserId, expense.creatorId, memberships));
      const allReceiptRows = await tx.objectStore("receiptMetadata").getAll();
      const available = allReceiptRows.map((row) => fromReceiptRecord(row, row.id)).filter((item) => item.contentStatus === "available");
      assertReceiptAdmission({
        expenseAvailableCount: available.filter((item) => item.expenseId === expense.expenseId).length,
        uploaderAvailableBytes: available.filter((item) => item.createdByUserId === input.metadata.createdByUserId).reduce((total, item) => total + item.sizeBytes, 0),
        projectAvailableBytes: available.reduce((total, item) => total + item.sizeBytes, 0),
      }, input.metadata.sizeBytes, this.receiptStoragePolicy);
      await tx.objectStore("receiptMetadata").add(toReceiptRecord(input.metadata));
      await tx.objectStore("receiptBlobs").add(receiptBlob(input.metadata, input.content));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.metadata.receiptId, completedAt: input.auditEvent.occurredAt }));
      await tx.done;
      return input.metadata.receiptId;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

  async deleteReceipt(input: Parameters<AtomicApplicationPersistence["deleteReceipt"]>[0]): Promise<void> {
    if (input.metadata.contentStatus !== "user-deleted" || !input.metadata.contentRemovedByUserId) throw new ApplicationError("CONFLICT", "Receipt deletion requires an explicit user-deleted state.");
    const tx = (await this.db()).transaction(["households", "memberships", "expenses", "receiptMetadata", "receiptBlobs", "auditEvents"], "readwrite");
    try {
      assertAuditMatches(input.auditEvent, input.metadata.householdId, input.metadata.contentRemovedByUserId);
      const [householdRaw, expenseRaw, receiptRaw, membershipRows] = await Promise.all([
        tx.objectStore("households").get(input.metadata.householdId),
        tx.objectStore("expenses").get(input.metadata.expenseId),
        tx.objectStore("receiptMetadata").get(input.metadata.receiptId),
        tx.objectStore("memberships").index("householdId").getAll(input.metadata.householdId),
      ]);
      if (!householdRaw || fromHouseholdRecord(householdRaw, input.metadata.householdId).deletedAt) throw householdStateChanged("The household is no longer active.");
      if (!expenseRaw) throw new ApplicationError("CONFLICT", "The expense is no longer available.");
      if (!receiptRaw) throw new ApplicationError("NOT_FOUND", "Receipt not found.");
      const expense = fromExpenseRecord(expenseRaw, input.metadata.expenseId);
      const current = fromReceiptRecord(receiptRaw, input.metadata.receiptId);
      if (expense.deletedAt || expense.householdId !== input.metadata.householdId || current.contentStatus !== "available") throw new ApplicationError("CONFLICT", "The receipt or expense changed before deletion.");
      if (
        current.householdId !== input.metadata.householdId || current.expenseId !== input.metadata.expenseId ||
        current.createdByUserId !== input.metadata.createdByUserId || current.mimeType !== input.metadata.mimeType ||
        current.originalFilename !== input.metadata.originalFilename || current.sizeBytes !== input.metadata.sizeBytes ||
        current.createdAt !== input.metadata.createdAt
      ) throw new ApplicationError("CONFLICT", "The receipt changed before deletion.");
      const memberships = membershipRows.map((row) => fromMembershipRecord(row, row.key));
      if (input.metadata.contentRemovedByUserId !== expense.creatorId) throw new ApplicationError("RECEIPT_PRIVATE_ACCESS_FORBIDDEN", "Only the Expense creator may remove Receipts.");
      assertCanEditExpense(getExpensePermissions(input.metadata.householdId, input.metadata.contentRemovedByUserId, expense.creatorId, memberships));
      await tx.objectStore("receiptMetadata").put(toReceiptRecord(input.metadata));
      await tx.objectStore("receiptBlobs").delete(input.metadata.receiptId);
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.done;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }
}
