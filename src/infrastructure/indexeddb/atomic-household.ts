import { ApplicationError } from "@/application/errors/application-error";
import { assertIdempotentIntent, commandOutcomeKey } from "@/application/idempotency/command-idempotency";
import { notificationDraft } from "@/application/notifications/notification-policy";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { DomainError } from "@/domain/shared/domain-error";
import { evaluateHouseholdDeletionEligibility, leaveHousehold, removeHouseholdMember } from "@/domain/membership/membership-eligibility";
import { transferLeadership } from "@/domain/membership/leadership-policy";
import { assertHousehold, toBalanceExpense, type Household } from "@/domain/records/domain-records";
import { auditEventId } from "@/domain/shared/identifiers";
import { persistenceFailure } from "./repositories";
import { fromCommandOutcomeRecord, fromExpenseRecord, fromHouseholdRecord, fromJoinRequestRecord, fromMembershipRecord, fromSettlementRecord, toAuditRecord, toCommandOutcomeRecord, toHouseholdRecord, toJoinRequestRecord, toMembershipRecord } from "./mappers";
import { activeMembershipUserKey, membershipKey, pendingJoinUserKey } from "./keys";
import { IndexedDbCommandContext, abortSafely, householdStateChanged, assertAuditMatches, notificationActorName, stageNotifications, householdNotifications, accountNotification } from "./atomic-context";

/** household commands retain their original complete transaction boundaries. */
export class IndexedDbHouseholdCommands implements Pick<AtomicApplicationPersistence, "createHousehold" | "renameHousehold" | "createJoinRequest" | "acceptJoinRequest" | "transitionJoinRequest" | "transferLeadership" | "leaveHousehold" | "removeHouseholdMember" | "deleteHousehold"> {
  constructor(private readonly context: IndexedDbCommandContext) {}

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
    const tx = (await this.context.db()).transaction(["households", "memberships", "joinRequests", "auditEvents", "commandOutcomes"], "readwrite");
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

async renameHousehold(input: Parameters<AtomicApplicationPersistence["renameHousehold"]>[0]): Promise<void> {
    if (input.name.trim() !== input.name || input.name.length === 0) {
      throw new ApplicationError("CONFLICT", "The House name must be non-empty and trimmed.");
    }
    const tx = (await this.context.db()).transaction(["households", "memberships", "userProfiles", "notifications", "auditEvents"], "readwrite");
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
      const memberships = (await tx.objectStore("memberships").index("householdId").getAll(input.householdId)).map((row) => fromMembershipRecord(row, row.key));
      const name = await notificationActorName(tx, input.actorId);
      await stageNotifications(tx, householdNotifications({ eventKey: input.auditEvent.auditEventId, actorId: input.actorId, householdId: input.householdId, type: "household-renamed", title: "Household renamed", body: `${name} renamed the household to ${input.name}`, createdAt: input.occurredAt, memberships }));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async createJoinRequest(input: Parameters<AtomicApplicationPersistence["createJoinRequest"]>[0]): Promise<string> {
    const request = toJoinRequestRecord(input.request);
    if (input.request.status !== "pending") throw new ApplicationError("CONFLICT", "New join requests must be Pending.");
    if (input.idempotency.actorId !== input.request.userId || input.idempotency.commandType !== "send-join-request") throw new ApplicationError("CONFLICT", "Join-request command identity is inconsistent.");
    const tx = (await this.context.db()).transaction(["households", "memberships", "joinRequests", "userProfiles", "notifications", "auditEvents", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) {
        const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey);
        assertIdempotentIntent(existing, input.idempotency);
        await tx.done;
        return existing.resourceId;
      }
      const [householdRaw, activeMembership, pendingRequest, membershipRows] = await Promise.all([
        tx.objectStore("households").get(input.request.householdId),
        tx.objectStore("memberships").index("activeMembershipUserKey").getKey(activeMembershipUserKey(input.request.userId)),
        tx.objectStore("joinRequests").index("pendingJoinUserKey").getKey(pendingJoinUserKey(input.request.userId)),
        tx.objectStore("memberships").index("householdId").getAll(input.request.householdId),
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
      const leader = membershipRows.map((row) => fromMembershipRecord(row, row.key)).find((item) => item.status === "active" && item.role === "leader");
      const name = await notificationActorName(tx, input.request.userId);
      if (leader) await stageNotifications(tx, [notificationDraft({ eventKey: input.idempotency.commandId, recipientUserId: leader.userId, type: "join-request-received", title: "New join request", body: `${name} requested to join your household`, createdAt: input.auditEvent.occurredAt, householdId: input.request.householdId, entityType: "join-request", entityId: input.request.joinRequestId })]);
      await tx.done;
      return input.request.joinRequestId;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async acceptJoinRequest(input: Parameters<AtomicApplicationPersistence["acceptJoinRequest"]>[0]): Promise<void> {
    const tx = (await this.context.db()).transaction(["households", "joinRequests", "memberships", "userProfiles", "notifications", "auditEvents"], "readwrite");
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
      const memberships = (await tx.objectStore("memberships").index("householdId").getAll(current.householdId)).map((row) => fromMembershipRecord(row, row.key));
      const name = await notificationActorName(tx, input.actorId);
      await stageNotifications(tx, [notificationDraft({ eventKey: input.auditEvent.auditEventId, recipientUserId: current.userId, type: "join-request-accepted", title: "Join request accepted", body: `${name} accepted your request to join the household`, createdAt: input.resolvedAt, householdId: current.householdId, entityType: "household", entityId: current.householdId }), ...householdNotifications({ eventKey: input.auditEvent.auditEventId, actorId: input.actorId, householdId: current.householdId, type: "member-joined", title: "New household member", body: `${name} joined the household`, createdAt: input.resolvedAt, entityType: "membership", entityId: current.userId, memberships: memberships.filter((member) => member.userId !== current.userId) })]);
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
    const tx = (await this.context.db()).transaction(["households", "memberships", "joinRequests", "userProfiles", "notifications", "auditEvents"], "readwrite");
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
      if (input.status === "rejected") {
        const name = await notificationActorName(tx, input.actorId);
        await stageNotifications(tx, [notificationDraft({ eventKey: input.auditEvent.auditEventId, recipientUserId: current.userId, type: "join-request-rejected", title: "Join request rejected", body: `${name} rejected your household join request`, createdAt: input.resolvedAt, householdId: current.householdId, entityType: "household", entityId: current.householdId })]);
      }
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async transferLeadership(input: Parameters<AtomicApplicationPersistence["transferLeadership"]>[0]): Promise<void> {
    assertAuditMatches(input.auditEvent, input.householdId, input.actorId);
    const tx = (await this.context.db()).transaction(["households", "memberships", "userProfiles", "notifications", "auditEvents"], "readwrite");
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
      const name = await notificationActorName(tx, input.actorId);
      await stageNotifications(tx, householdNotifications({ eventKey: input.auditEvent.auditEventId, actorId: input.actorId, householdId: input.householdId, type: "leadership-transferred", title: "Leadership transferred", body: `${name} transferred household leadership`, createdAt: input.auditEvent.occurredAt, entityType: "membership", entityId: input.targetId, memberships: result }));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async leaveHousehold(input: Parameters<AtomicApplicationPersistence["leaveHousehold"]>[0]): Promise<void> {
    assertAuditMatches(input.auditEvent, input.householdId, input.actorId);
    const tx = (await this.context.db()).transaction(["households", "memberships", "expenses", "settlements", "userProfiles", "notifications", "auditEvents"], "readwrite");
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
      const name = await notificationActorName(tx, input.actorId);
      await stageNotifications(tx, householdNotifications({ eventKey: input.auditEvent.auditEventId, actorId: input.actorId, householdId: input.householdId, type: "member-left-or-removed", title: "Member left", body: `${name} left the household`, createdAt: input.auditEvent.occurredAt, entityType: "membership", entityId: input.actorId, memberships: result }));
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async removeHouseholdMember(input: Parameters<AtomicApplicationPersistence["removeHouseholdMember"]>[0]): Promise<void> {
    assertAuditMatches(input.auditEvent, input.householdId, input.actorId);
    const tx = (await this.context.db()).transaction(["households", "memberships", "expenses", "settlements", "userProfiles", "notifications", "auditEvents"], "readwrite");
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
      const name = await notificationActorName(tx, input.actorId);
      const remaining = householdNotifications({ eventKey: input.auditEvent.auditEventId, actorId: input.actorId, householdId: input.householdId, type: "member-left-or-removed", title: "Member removed", body: `${name} removed a member from the household`, createdAt: input.auditEvent.occurredAt, entityType: "membership", entityId: input.targetId, memberships: result });
      await stageNotifications(tx, [...remaining, accountNotification({ eventKey: input.auditEvent.auditEventId, recipientUserId: input.targetId, type: "member-left-or-removed", title: "Household membership changed", body: "You were removed from the household", createdAt: input.auditEvent.occurredAt })]);
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async deleteHousehold(input: Parameters<AtomicApplicationPersistence["deleteHousehold"]>[0]): Promise<void> {
    assertAuditMatches(input.auditEvent, input.householdId, input.actorId);
    const tx = (await this.context.db()).transaction(["households", "memberships", "joinRequests", "expenses", "settlements", "auditEvents"], "readwrite");
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
}
