import "server-only";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { ApplicationError } from "@/application/errors/application-error";
import { type AuditEvent } from "@/domain/records/domain-records";
import { auditEventId } from "@/domain/shared/identifiers";
import { membershipRowId } from "../ids";
import { mapHousehold, mapJoinRequest } from "../reads/mappers.server";
import { runCommandTransaction } from "./tx-runner.server";
import { CommandGuardEngine } from "./guards.server";
import { notificationDraft } from "@/application/notifications/notification-policy";
import { AppwriteCommandContext, TABLE, MAX_ACTIVE_HOUSEHOLD_MEMBERS } from "./command-context.server";

/** household commands retain their original complete transaction boundaries. */
export class AppwriteHouseholdCommands implements Pick<AtomicApplicationPersistence, "createHousehold" | "createJoinRequest" | "acceptJoinRequest" | "transitionJoinRequest" | "renameHousehold" | "transferLeadership" | "leaveHousehold" | "removeHouseholdMember" | "deleteHousehold"> {
  constructor(private readonly context: AppwriteCommandContext) {}

// -- protected creates ----------------------------------------------------

  async createHousehold(input: Parameters<AtomicApplicationPersistence["createHousehold"]>[0]): Promise<string> {
    const tablesDB = this.context.tablesDB;
    const { household, leaderMembership, idempotency, auditEvent } = input;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(leaderMembership.userId), intentSeed: { name: household.name, code: household.code } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, household.createdAt);

      const codeOwner = (await tables.listRows(TABLE.households, [])).map(mapHousehold).find((candidate) => candidate.code === household.code);
      if (codeOwner) throw new ApplicationError("CONFLICT", "Household code is already in use.");
      if ((await this.context.activeMemberships(tables)).some((m) => m.userId === leaderMembership.userId)) {
        throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
      }
      const pending = (await tables.listRows(TABLE.joinRequests, [])).map(mapJoinRequest)
        .find((request) => request.userId === leaderMembership.userId && request.status === "pending");
      if (pending) throw new ApplicationError("CONFLICT", "Cancel the current Pending join request first.");

      await guards.acquire("active-membership", String(leaderMembership.userId), String(leaderMembership.userId));
      await guards.acquire("active-leader", String(household.householdId), String(leaderMembership.userId));
      await guards.acquire("financial", String(household.householdId));

      await tablesDB.createRow({
        databaseId: "hft",
        tableId: TABLE.households,
        rowId: household.householdId,
        data: { name: household.name, code: household.code, version: 1, createdAt: household.createdAt, updatedAt: household.updatedAt, deletedAt: null, deletedByUserId: null },
        transactionId: tx.id,
      });
      tx.recordStagedOperation();

      await tablesDB.createRow({
        databaseId: "hft",
        tableId: TABLE.memberships,
        rowId: membershipRowId(String(leaderMembership.householdId), String(leaderMembership.userId)),
        data: {
          householdId: String(leaderMembership.householdId),
          userId: String(leaderMembership.userId),
          role: leaderMembership.role,
          status: leaderMembership.status,
          joinedAt: household.createdAt,
          leftAt: null,
          statusChangedAt: household.createdAt,
          version: 1,
        },
        transactionId: tx.id,
      });
      tx.recordStagedOperation();

        await this.context.stageAudit(tablesDB, tx, auditEvent);
        await this.context.stageOutcome(tablesDB, tx, idempotency, String(household.householdId), household.createdAt);
        return String(household.householdId);
      }),
      (committedResourceId) => committedResourceId,
      idempotency,
    );
  }

async createJoinRequest(input: Parameters<AtomicApplicationPersistence["createJoinRequest"]>[0]): Promise<string> {
    const tablesDB = this.context.tablesDB;
    const { request, idempotency, auditEvent } = input;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(request.userId), intentSeed: { householdId: String(request.householdId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, request.createdAt);

      if ((await this.context.activeMemberships(tables)).some((m) => m.userId === request.userId)) {
        throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
      }
      const existingPending = (await tables.listRows(TABLE.joinRequests, [])).map(mapJoinRequest)
        .find((candidate) => candidate.userId === request.userId && candidate.status === "pending");
      if (existingPending) throw new ApplicationError("CONFLICT", "Cancel the current Pending join request first.");

      await guards.acquire("pending-join", String(request.userId), String(request.userId));
      await tablesDB.createRow({
        databaseId: "hft",
        tableId: TABLE.joinRequests,
        rowId: request.joinRequestId,
        data: {
          householdId: String(request.householdId),
          userId: String(request.userId),
          status: request.status,
          requesterDisplayName: null,
          createdAt: request.createdAt,
          resolvedAt: null,
          resolvedByUserId: null,
        },
        transactionId: tx.id,
      });
      tx.recordStagedOperation();

        await this.context.stageAudit(tablesDB, tx, auditEvent);
        await this.context.stageOutcome(tablesDB, tx, idempotency, String(request.joinRequestId), request.createdAt);
        const members = await this.context.activeMemberships(tables, String(request.householdId));
        const leader = members.find((member) => member.role === "leader");
        if (leader) await this.context.stageNotifications(tablesDB, tx, [notificationDraft({ eventKey: String(idempotency.commandId), recipientUserId: leader.userId, type: "join-request-received", title: "New join request", body: `${await this.context.notificationName(tables, String(request.userId))} requested to join your household`, createdAt: request.createdAt as never, householdId: request.householdId, entityType: "join-request", entityId: request.joinRequestId })]);
        this.context.lastR3StagedOperations.createJoinRequest = tx.stagedOperations();
        return String(request.joinRequestId);
      }),
      (committedResourceId) => committedResourceId,
      idempotency,
    );
  }

// -- lifecycle transitions -------------------------------------------------

  async acceptJoinRequest(input: Parameters<AtomicApplicationPersistence["acceptJoinRequest"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { joinRequestId: String(input.joinRequestId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.resolvedAt);

      const raw = await tables.getRow(TABLE.joinRequests, String(input.joinRequestId));
      const request = raw ? mapJoinRequest(raw) : undefined;
      if (!request || request.status !== "pending") throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The join request is no longer Pending.");

      const household = await this.context.getAliveHousehold(tables, String(request.householdId));
      const actorMembership = (await this.context.activeMemberships(tables, household.householdId)).find((m) => m.userId === input.actorId);
      if (!actorMembership || actorMembership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household join requests not found.");
      if ((await this.context.activeMemberships(tables)).some((m) => m.userId === request.userId)) {
        throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The requester already belongs to a household.");
      }
      const activeCount = (await this.context.activeMemberships(tables, household.householdId)).length;
      if (activeCount >= MAX_ACTIVE_HOUSEHOLD_MEMBERS) {
        throw new ApplicationError("CONFLICT", "HOUSEHOLD_MEMBER_LIMIT_REACHED");
      }

      await guards.touch("financial", String(household.householdId));
      await guards.release("pending-join", String(request.userId));
      await guards.acquire("active-membership", String(request.userId), String(request.userId));

      await this.context.stagedRequestUpdate(tablesDB, tx, { ...request, status: "accepted", resolvedAt: input.resolvedAt, resolvedByUserId: input.actorId });
      await tablesDB.createRow({
        databaseId: "hft",
        tableId: TABLE.memberships,
        rowId: membershipRowId(String(request.householdId), String(request.userId)),
        data: {
          householdId: String(request.householdId),
          userId: String(request.userId),
          role: "member",
          status: "active",
          joinedAt: input.resolvedAt,
          leftAt: null,
          statusChangedAt: input.resolvedAt,
          version: 1,
        },
        transactionId: tx.id,
      });
      tx.recordStagedOperation();
      await this.context.stageAudit(tablesDB, tx, input.auditEvent);
      const membersAfterJoin = await this.context.activeMemberships(tables, String(request.householdId));
      const actorName = await this.context.notificationName(tables, String(input.actorId));
      await this.context.stageNotifications(tablesDB, tx, [notificationDraft({ eventKey: String(input.auditEvent.auditEventId), recipientUserId: request.userId, type: "join-request-accepted", title: "Join request accepted", body: `${actorName} accepted your request to join the household`, createdAt: input.resolvedAt as never, householdId: request.householdId, entityType: "household", entityId: request.householdId }), ...this.context.householdNotifications({ eventKey: String(input.auditEvent.auditEventId), actorId: String(input.actorId), householdId: String(request.householdId), type: "member-joined", title: "New household member", body: `${actorName} joined the household`, createdAt: input.resolvedAt, entityType: "membership", entityId: String(request.userId), memberships: membersAfterJoin.filter((member) => member.userId !== request.userId) })]);
        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { joinRequestId: String(input.joinRequestId) }, String(input.joinRequestId), input.resolvedAt);
        this.context.lastR3StagedOperations.acceptJoinRequest = tx.stagedOperations();
      }),
      () => undefined,
    );
  }

async transitionJoinRequest(input: Parameters<AtomicApplicationPersistence["transitionJoinRequest"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { joinRequestId: String(input.joinRequestId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.resolvedAt);

      const raw = await tables.getRow(TABLE.joinRequests, String(input.joinRequestId));
      const request = raw ? mapJoinRequest(raw) : undefined;
      if (!request || request.status !== "pending") throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The join request is no longer Pending.");
      if (input.status === "cancelled" && String(request.userId) !== String(input.actorId)) {
        throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "Only the requester may cancel this request.");
      }
      if (input.status === "rejected") {
        const actorMembership = (await this.context.activeMemberships(tables, request.householdId)).find((m) => m.userId === input.actorId);
        if (!actorMembership || actorMembership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household join requests not found.");
      }

      await guards.release("pending-join", String(request.userId));
      await this.context.stagedRequestUpdate(tablesDB, tx, { ...request, status: input.status, resolvedAt: input.resolvedAt, resolvedByUserId: input.actorId });
      await this.context.stageAudit(tablesDB, tx, input.auditEvent);
      if (input.status === "rejected") await this.context.stageNotifications(tablesDB, tx, [notificationDraft({ eventKey: String(input.auditEvent.auditEventId), recipientUserId: request.userId, type: "join-request-rejected", title: "Join request rejected", body: `${await this.context.notificationName(tables, String(input.actorId))} rejected your household join request`, createdAt: input.resolvedAt as never, householdId: request.householdId, entityType: "household", entityId: request.householdId })]);
        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { joinRequestId: String(input.joinRequestId) }, String(input.joinRequestId), input.resolvedAt);
        this.context.lastR3StagedOperations[`join-request-${input.status}`] = tx.stagedOperations();
      }),
      () => undefined,
    );
  }

async renameHousehold(input: Parameters<AtomicApplicationPersistence["renameHousehold"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId), name: input.name } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const { household } = await this.context.requireScopeWithRole(tables, String(input.actorId), "leader");
      if (input.name.trim() !== input.name || input.name.length === 0) {
        throw new ApplicationError("CONFLICT", "The House name must be non-empty and trimmed.");
      }
      if (household.name === input.name) return;

      await tablesDB.updateRow({
        databaseId: "hft",
        tableId: TABLE.households,
        rowId: String(household.householdId),
        data: { name: input.name, updatedAt: input.occurredAt },
        transactionId: tx.id,
      });
      tx.recordStagedOperation();
              await this.context.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId), name: input.name }, String(input.householdId), input.occurredAt);
await this.context.stageAudit(tablesDB, tx, input.auditEvent);
      const renameMembers = await this.context.activeMemberships(tables, String(input.householdId));
      const renameName = await this.context.notificationName(tables, String(input.actorId));
      await this.context.stageNotifications(tablesDB, tx, this.context.householdNotifications({ eventKey: String(input.auditEvent.auditEventId), actorId: String(input.actorId), householdId: String(input.householdId), type: "household-renamed", title: "Household renamed", body: `${renameName} renamed the household to ${input.name}`, createdAt: input.occurredAt, memberships: renameMembers }));
      this.context.lastR3StagedOperations.renameHousehold = tx.stagedOperations();
      }),
      () => undefined,
    );;
  }

async transferLeadership(input: Parameters<AtomicApplicationPersistence["transferLeadership"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId), targetId: String(input.targetId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.auditEvent.occurredAt);
      const { household, memberships, actorMembership } = await this.context.requireScopeWithRole(tables, String(input.actorId), "leader");

      const target = memberships.find((m) => m.userId === input.targetId && m.status === "active");
      if (!target || target.userId === actorMembership.userId) throw new ApplicationError("NOT_FOUND", "Leadership transfer target not found.");

      await guards.touch("financial", String(household.householdId));
      await guards.transferOwnership("active-leader", String(household.householdId), String(actorMembership.userId), String(input.targetId));
      await this.context.stagedMembershipUpdate(tablesDB, tx, { ...actorMembership, role: "member" }, input.auditEvent.occurredAt);
      await this.context.stagedMembershipUpdate(tablesDB, tx, { ...target, role: "leader" }, input.auditEvent.occurredAt);
      await this.context.stageAudit(tablesDB, tx, input.auditEvent);

      const transferName = await this.context.notificationName(tables, String(input.actorId));
      await this.context.stageNotifications(tablesDB, tx, this.context.householdNotifications({ eventKey: String(input.auditEvent.auditEventId), actorId: String(input.actorId), householdId: String(input.householdId), type: "leadership-transferred", title: "Leadership transferred", body: `${transferName} transferred household leadership`, createdAt: input.auditEvent.occurredAt, entityType: "membership", entityId: String(input.targetId), memberships: await this.context.activeMemberships(tables, String(input.householdId)) }));

        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId), targetId: String(input.targetId) }, String(input.householdId), input.auditEvent.occurredAt);
        this.context.lastR3StagedOperations.transferLeadership = tx.stagedOperations();
      }),
      () => undefined,
    );;
  }

async leaveHousehold(input: Parameters<AtomicApplicationPersistence["leaveHousehold"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.auditEvent.occurredAt);
      const scope = await this.context.requireScopeWithRole(tables, String(input.actorId), undefined);
      if (scope.actorMembership.role === "leader") {
        throw new ApplicationError("CONFLICT", "Transfer leadership before leaving the household.");
      }
      const context = await this.context.financialContext(tables, String(scope.household.householdId));
      this.context.assertExactZeroBalance(context.sheet, String(input.actorId), "leaving");
      this.context.assertNoPendingSettlement(context.settlements, String(input.actorId), "leaving");

      await guards.touch("financial", String(scope.household.householdId));
      await guards.release("active-membership", String(input.actorId));
      await this.context.stagedMembershipUpdate(tablesDB, tx, { ...scope.actorMembership, status: "former" }, input.auditEvent.occurredAt);
      await this.context.stageAudit(tablesDB, tx, input.auditEvent);

      const leaveName = await this.context.notificationName(tables, String(input.actorId));
      await this.context.stageNotifications(tablesDB, tx, this.context.householdNotifications({ eventKey: String(input.auditEvent.auditEventId), actorId: String(input.actorId), householdId: String(input.householdId), type: "member-left-or-removed", title: "Member left", body: `${leaveName} left the household`, createdAt: input.auditEvent.occurredAt, entityType: "membership", entityId: String(input.actorId), memberships: await this.context.activeMemberships(tables, String(input.householdId)) }));

        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId) }, String(input.householdId), input.auditEvent.occurredAt);
        this.context.lastR3StagedOperations.leaveHousehold = tx.stagedOperations();
      }),
      () => undefined,
    );;
  }

async removeHouseholdMember(input: Parameters<AtomicApplicationPersistence["removeHouseholdMember"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId), targetId: String(input.targetId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.auditEvent.occurredAt);
      await this.context.requireScopeWithRole(tables, String(input.actorId), "leader");
      const target = (await this.context.activeMemberships(tables, input.householdId)).find((m) => m.userId === input.targetId);
      if (!target) throw new ApplicationError("NOT_FOUND", "Household member not found.");
      if (target.role === "leader") throw new ApplicationError("CONFLICT", "The House Leader cannot be removed. Transfer leadership first.");
      const context = await this.context.financialContext(tables, String(input.householdId));
      this.context.assertExactZeroBalance(context.sheet, String(input.targetId), "removing the member");
      this.context.assertNoPendingSettlement(context.settlements, String(input.targetId), "removing the member");

      await guards.touch("financial", String(input.householdId));
      await guards.release("active-membership", String(input.targetId));
      await this.context.stagedMembershipUpdate(tablesDB, tx, { ...target, status: "former" }, input.auditEvent.occurredAt);
      await this.context.stageAudit(tablesDB, tx, input.auditEvent);

      const removeName = await this.context.notificationName(tables, String(input.actorId));
      const remaining = this.context.householdNotifications({ eventKey: String(input.auditEvent.auditEventId), actorId: String(input.actorId), householdId: String(input.householdId), type: "member-left-or-removed", title: "Member removed", body: `${removeName} removed a member from the household`, createdAt: input.auditEvent.occurredAt, entityType: "membership", entityId: String(input.targetId), memberships: await this.context.activeMemberships(tables, String(input.householdId)) });
      await this.context.stageNotifications(tablesDB, tx, [...remaining, notificationDraft({ eventKey: String(input.auditEvent.auditEventId), recipientUserId: input.targetId, type: "member-left-or-removed", title: "Household membership changed", body: "You were removed from the household", createdAt: input.auditEvent.occurredAt as never, accountScoped: true })]);

        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId), targetId: String(input.targetId) }, String(input.householdId), input.auditEvent.occurredAt);
        this.context.lastR3StagedOperations.removeHouseholdMember = tx.stagedOperations();
      }),
      () => undefined,
    );;
  }

/**
   * Actual measured worst-case staged writes:
   * tombstone(1) + M membership updates + M active-membership guard releases +
   * leader-guard release(1) + financial-guard release(1) + J closures + J
   * pending-join releases + J closure audits + household audit(1)
   * = 4 + 2M + 3J ≤ 15 under the four-account envelope (M + J ≤ 4).
   */
  async deleteHousehold(input: Parameters<AtomicApplicationPersistence["deleteHousehold"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.context.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.auditEvent.occurredAt);
      const { household, memberships } = await this.context.requireScopeWithRole(tables, String(input.actorId), "leader");

      const context = await this.context.financialContext(tables, String(household.householdId));
      for (const member of memberships) {
        this.context.assertExactZeroBalance(context.sheet, String(member.userId), "deleting the household");
      }
      this.context.assertNoPendingSettlement(context.settlements, null, "deleting the household");

      await tablesDB.updateRow({
        databaseId: "hft",
        tableId: TABLE.households,
        rowId: String(household.householdId),
        data: { deletedAt: input.auditEvent.occurredAt, deletedByUserId: String(input.actorId), updatedAt: input.auditEvent.occurredAt },
        transactionId: tx.id,
      });
      tx.recordStagedOperation();

      for (const member of memberships) {
        await guards.release("active-membership", String(member.userId));
        await this.context.stagedMembershipUpdate(tablesDB, tx, { ...member, status: "former" }, input.auditEvent.occurredAt);
      }
      await guards.release("active-leader", String(household.householdId));
      await guards.release("financial", String(household.householdId));

      const pendingRequests = (await tables.listRows(TABLE.joinRequests, [])).map(mapJoinRequest)
        .filter((request) => request.householdId === household.householdId && request.status === "pending");
      let closureSequence = 0;
      for (const request of pendingRequests) {
        closureSequence += 1;
        const closureAudit: AuditEvent = {
          ...input.auditEvent,
          auditEventId: auditEventId(`${String(input.joinRequestAuditIdBase)}-${closureSequence}`),
          aggregateType: "join-request",
          aggregateId: String(request.joinRequestId),
          action: "household-closed",
          changedFields: ["status"],
        };
        await guards.release("pending-join", String(request.userId));
        await this.context.stagedRequestUpdate(tablesDB, tx, { ...request, status: "household-closed", resolvedAt: input.auditEvent.occurredAt, resolvedByUserId: input.actorId });
        await this.context.stageAudit(tablesDB, tx, closureAudit);
      }

      await this.context.stageAudit(tablesDB, tx, input.auditEvent);
      await this.context.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId) }, String(input.householdId), input.auditEvent.occurredAt);
      this.context.lastDeleteStagedOperations = tx.stagedOperations();
      }),
      () => undefined,
    );
  }
}
