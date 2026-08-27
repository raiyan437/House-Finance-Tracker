import "server-only";
import type { TablesDB } from "node-appwrite";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { ApplicationError } from "@/application/errors/application-error";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import type { HouseholdBalanceSheet } from "@/domain/balances/balance-types";
import { toBalanceExpense } from "@/domain/records/domain-records";
import { canonicalIntentDigest } from "@/application/idempotency/command-idempotency";
import type { AuditEvent, Household, JoinRequest } from "@/domain/records/domain-records";
import type { HouseholdId } from "@/domain/shared/identifiers";
import { auditEventId } from "@/domain/shared/identifiers";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { commandOutcomeRowId, membershipRowId } from "../ids";
import { mapExpense, mapHousehold, mapJoinRequest, mapMembership, mapSettlement } from "../reads/mappers.server";
import { createTablesReader, type TablesReader } from "../reads/tables.server";
import { runCommandTransaction, type CommandTransaction } from "./tx-runner.server";
import { TransactionFailure } from "./tx-errors.server";
import { currentCommandEnvelope } from "./command-envelope.server";
import { CommandGuardEngine } from "./guards.server";

const TABLE = {
  households: "households",
  memberships: "memberships",
  joinRequests: "join_requests",
  expenses: "expenses",
  settlements: "settlements",
  auditEvents: "audit_events",
  commandOutcomes: "command_outcomes",
} as const;

const MAX_ACTIVE_HOUSEHOLD_MEMBERS = 4;

interface HouseholdScope {
  readonly household: Household;
  readonly memberships: readonly MembershipSnapshot[];
  readonly actorMembership: MembershipSnapshot;
}

/**
 * Trusted command persistence for the R2 household/membership/join-request
 * surface (13D/13E/13F). Every method opens ONE provider transaction,
 * re-reads authoritative state through transaction-scoped reads, revalidates
 * every frozen gate server-side, stages business rows + audits + coordination
 * guards (+ idempotency outcomes for protected creates), and commits. Stale
 * pre-check state fails with typed conflicts; commit-time provider conflicts
 * compose as defense in depth. R3+ aggregates intentionally remain
 * placeholders until their own authorized slices.
 */
export class AppwriteCommandPersistence implements AtomicApplicationPersistence {
  /** Measured staged-write count of the most recent deleteHousehold execution. */
  lastDeleteStagedOperations = 0;

  constructor(private readonly tablesDB: TablesDB) {}

  // -- shared helpers -------------------------------------------------------

  private scoped(tablesDB: TablesDB, tx: CommandTransaction): TablesReader {
    return createTablesReader(tablesDB, { transactionId: tx.id });
  }

  private async stageAudit(tablesDB: TablesDB, tx: CommandTransaction, audit: AuditEvent): Promise<void> {
    await tablesDB.createRow({
      databaseId: "hft",
      tableId: TABLE.auditEvents,
      rowId: audit.auditEventId,
      data: {
        householdId: audit.householdId,
        aggregateType: audit.aggregateType,
        aggregateId: audit.aggregateId,
        actorId: audit.actorId,
        action: audit.action,
        changedFieldsJson: JSON.stringify(audit.changedFields),
        occurredAt: audit.occurredAt,
      },
      transactionId: tx.id,
    });
    tx.recordStagedOperation();
  }

  private async stageOutcome(
    tablesDB: TablesDB,
    tx: CommandTransaction,
    descriptor: Readonly<{ actorId: string; commandType: string; commandId: string; intentDigest: string }>,
    resourceId: string,
    completedAt: string,
  ): Promise<void> {
    await tablesDB.createRow({
      databaseId: "hft",
      tableId: TABLE.commandOutcomes,
      rowId: commandOutcomeRowId(descriptor),
      data: {
        actorId: descriptor.actorId,
        commandType: descriptor.commandType,
        commandId: descriptor.commandId,
        intentDigest: descriptor.intentDigest,
        resourceId,
        completedAt,
      },
      transactionId: tx.id,
    });
    tx.recordStagedOperation();
  }

  private async getAliveHousehold(tables: TablesReader, id: string): Promise<Household> {
    const row = await tables.getRow(TABLE.households, id);
    const household = row ? mapHousehold(row) : undefined;
    if (!household || household.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
    return household;
  }

  private async activeMemberships(tables: TablesReader, householdId?: string): Promise<readonly MembershipSnapshot[]> {
    const rows = await tables.listRows(TABLE.memberships, []);
    return rows.map(mapMembership).filter((m) => m.status === "active" && (householdId === undefined || m.householdId === householdId));
  }

  private async requireScopeWithRole(tables: TablesReader, actorId: string, role: "leader" | undefined): Promise<HouseholdScope> {
    const allActive = await this.activeMemberships(tables);
    const actorMembership = allActive.find((m) => m.userId === actorId);
    if (!actorMembership) throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "You are no longer an active household member.");
    if (role === "leader" && actorMembership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household not found.");
    const household = await this.getAliveHousehold(tables, String(actorMembership.householdId));
    const memberships = allActive.filter((m) => m.householdId === household.householdId);
    return { household, memberships, actorMembership };
  }

  private async financialContext(tables: TablesReader, householdId: string) {
    const [membershipRows, expenseRows, settlementRows] = await Promise.all([
      tables.listRows(TABLE.memberships, []),
      tables.listRows(TABLE.expenses, []),
      tables.listRows(TABLE.settlements, []),
    ]);
    const memberships = membershipRows.map(mapMembership);
    const expenses = expenseRows.map(mapExpense).filter((e) => e.householdId === householdId);
    const settlements = settlementRows.map(mapSettlement).filter((s) => s.householdId === householdId);
    return {
      settlements,
      sheet: calculateHouseholdBalances(householdId as HouseholdId, memberships, expenses.map(toBalanceExpense), settlements),
    };
  }

  private assertExactZeroBalance(sheet: HouseholdBalanceSheet, userId: string, actionLabel: string): void {
    const balance = sheet.balances.find((entry: { memberId: unknown; balance: number }) => String(entry.memberId) === userId);
    if (!balance || Number(balance.balance) !== 0) {
      throw new ApplicationError("CONFLICT", `The exact balance must be zero before ${actionLabel}.`);
    }
  }

  private assertNoPendingSettlement(settlements: readonly SettlementRecord[], userId: string | null, actionLabel: string): void {
    const pending = settlements.find(
      (settlement) =>
        settlement.status === "pending" &&
        (userId === null || String(settlement.senderId) === userId || String(settlement.receiverId) === userId),
    );
    if (pending) throw new ApplicationError("CONFLICT", `All Pending settlements must be resolved before ${actionLabel}.`);
  }

  private async stagedRequestUpdate(tablesDB: TablesDB, tx: CommandTransaction, request: JoinRequest): Promise<void> {
    await tablesDB.updateRow({
      databaseId: "hft",
      tableId: TABLE.joinRequests,
      rowId: request.joinRequestId,
      data: {
        status: request.status,
        resolvedAt: request.resolvedAt ?? null,
        resolvedByUserId: request.resolvedByUserId ?? null,
      },
      transactionId: tx.id,
    });
    tx.recordStagedOperation();
  }

  private async stagedMembershipUpdate(tablesDB: TablesDB, tx: CommandTransaction, membership: MembershipSnapshot, instant: string): Promise<void> {
    const former = membership.status === "former";
    await tablesDB.updateRow({
      databaseId: "hft",
      tableId: TABLE.memberships,
      rowId: membershipRowId(String(membership.householdId), String(membership.userId)),
      data: {
        role: membership.role,
        status: membership.status,
        leftAt: former ? instant : null,
        statusChangedAt: instant,
      },
      transactionId: tx.id,
    });
    tx.recordStagedOperation();
  }

  /** Committed-outcome lookup for replay and post-conflict disambiguation. */
  private async findCommittedOutcome(
    tablesDB: TablesDB,
    descriptor: Readonly<{ actorId: string; commandType: string; commandId: string; intentDigest: string }>,
  ): Promise<string | undefined> {
    const tables = createTablesReader(tablesDB);
    const rowId = commandOutcomeRowId({
      actorId: String(descriptor.actorId),
      commandType: descriptor.commandType,
      commandId: String(descriptor.commandId),
    });
    const row = await tables.getRow(TABLE.commandOutcomes, rowId);
    if (!row) return undefined;
    if (String(row.intentDigest) !== descriptor.intentDigest) {
      throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for different content.");
    }
    return String(row.resourceId);
  }

  /**
   * Delivery envelope for the current external mutation (R2): when present,
   * lost-response retries replay the original sanitized outcome and changed
   * intents fail closed before any business gate runs. Absent locally.
   */
  private async resolveDelivery<T>(
    tablesDB: TablesDB,
    input: Readonly<{ actorId: string; intentSeed: Record<string, unknown> }>,
    run: () => Promise<T>,
    onReplay: (committedResourceId: string) => T,
    explicitDescriptor?: Readonly<{ actorId: string; commandType: string; commandId: string; intentDigest: string }>,
  ): Promise<T> {
    const descriptor =
      explicitDescriptor ??
      (() => {
        const envelope = currentCommandEnvelope();
        if (!envelope) return undefined;
        return {
          actorId: String(input.actorId),
          commandType: envelope.commandType,
          commandId: envelope.commandId,
          intentDigest: canonicalIntentDigest(envelope.intentSeed),
        };
      })();
    // No delivery envelope and no explicit descriptor (local composition): plain execution.
    if (!descriptor) return run();
    const committed = await this.findCommittedOutcome(tablesDB, descriptor);
    if (committed !== undefined) return onReplay(committed);
    try {
      return await run();
    } catch (error) {
      if (error instanceof TransactionFailure && error.kind === "conflict") {
        const concurrent = await this.findCommittedOutcome(tablesDB, descriptor).catch(() => undefined);
        if (concurrent !== undefined) return onReplay(concurrent);
      }
      throw error;
    }
  }

  /** Stages the ledger row for the active envelope; no-op when absent (local). */
  private async stageEnvelopeOutcome(
    tablesDB: TablesDB,
    tx: CommandTransaction,
    actorId: string,
    intentSeed: Record<string, unknown>,
    resourceId: string,
    completedAt: string,
  ): Promise<void> {
    const envelope = currentCommandEnvelope();
    if (!envelope) return;
    await this.stageOutcome(
      tablesDB,
      tx,
      {
        actorId: String(actorId),
        commandType: envelope.commandType,
        commandId: envelope.commandId,
        intentDigest: canonicalIntentDigest(intentSeed),
      },
      resourceId,
      completedAt,
    );
  }
  // -- protected creates ----------------------------------------------------

  async createHousehold(input: Parameters<AtomicApplicationPersistence["createHousehold"]>[0]): Promise<string> {
    const tablesDB = this.tablesDB;
    const { household, leaderMembership, idempotency, auditEvent } = input;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(leaderMembership.userId), intentSeed: { name: household.name, code: household.code } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, household.createdAt);

      const codeOwner = (await tables.listRows(TABLE.households, [])).map(mapHousehold).find((candidate) => candidate.code === household.code);
      if (codeOwner) throw new ApplicationError("CONFLICT", "Household code is already in use.");
      if ((await this.activeMemberships(tables)).some((m) => m.userId === leaderMembership.userId)) {
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

        await this.stageAudit(tablesDB, tx, auditEvent);
        await this.stageOutcome(tablesDB, tx, idempotency, String(household.householdId), household.createdAt);
        return String(household.householdId);
      }),
      (committedResourceId) => committedResourceId,
      idempotency,
    );
  }

  async createJoinRequest(input: Parameters<AtomicApplicationPersistence["createJoinRequest"]>[0]): Promise<string> {
    const tablesDB = this.tablesDB;
    const { request, idempotency, auditEvent } = input;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(request.userId), intentSeed: { householdId: String(request.householdId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, request.createdAt);

      if ((await this.activeMemberships(tables)).some((m) => m.userId === request.userId)) {
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

        await this.stageAudit(tablesDB, tx, auditEvent);
        await this.stageOutcome(tablesDB, tx, idempotency, String(request.joinRequestId), request.createdAt);
        return String(request.joinRequestId);
      }),
      (committedResourceId) => committedResourceId,
      idempotency,
    );
  }

  // -- lifecycle transitions -------------------------------------------------

  async acceptJoinRequest(input: Parameters<AtomicApplicationPersistence["acceptJoinRequest"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { joinRequestId: String(input.joinRequestId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.resolvedAt);

      const raw = await tables.getRow(TABLE.joinRequests, String(input.joinRequestId));
      const request = raw ? mapJoinRequest(raw) : undefined;
      if (!request || request.status !== "pending") throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The join request is no longer Pending.");

      const household = await this.getAliveHousehold(tables, String(request.householdId));
      const actorMembership = (await this.activeMemberships(tables, household.householdId)).find((m) => m.userId === input.actorId);
      if (!actorMembership || actorMembership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household join requests not found.");
      if ((await this.activeMemberships(tables)).some((m) => m.userId === request.userId)) {
        throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The requester already belongs to a household.");
      }
      const activeCount = (await this.activeMemberships(tables, household.householdId)).length;
      if (activeCount >= MAX_ACTIVE_HOUSEHOLD_MEMBERS) {
        throw new ApplicationError("CONFLICT", "HOUSEHOLD_MEMBER_LIMIT_REACHED");
      }

      await guards.release("pending-join", String(request.userId));
      await guards.acquire("active-membership", String(request.userId), String(request.userId));

      await this.stagedRequestUpdate(tablesDB, tx, { ...request, status: "accepted", resolvedAt: input.resolvedAt, resolvedByUserId: input.actorId });
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
      await this.stageAudit(tablesDB, tx, input.auditEvent);
        await this.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { joinRequestId: String(input.joinRequestId) }, String(input.joinRequestId), input.resolvedAt);
      }),
      () => undefined,
    );
  }

  async transitionJoinRequest(input: Parameters<AtomicApplicationPersistence["transitionJoinRequest"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { joinRequestId: String(input.joinRequestId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.resolvedAt);

      const raw = await tables.getRow(TABLE.joinRequests, String(input.joinRequestId));
      const request = raw ? mapJoinRequest(raw) : undefined;
      if (!request || request.status !== "pending") throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The join request is no longer Pending.");
      if (input.status === "cancelled" && String(request.userId) !== String(input.actorId)) {
        throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "Only the requester may cancel this request.");
      }
      if (input.status === "rejected") {
        const actorMembership = (await this.activeMemberships(tables, request.householdId)).find((m) => m.userId === input.actorId);
        if (!actorMembership || actorMembership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household join requests not found.");
      }

      await guards.release("pending-join", String(request.userId));
      await this.stagedRequestUpdate(tablesDB, tx, { ...request, status: input.status, resolvedAt: input.resolvedAt, resolvedByUserId: input.actorId });
      await this.stageAudit(tablesDB, tx, input.auditEvent);
        await this.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { joinRequestId: String(input.joinRequestId) }, String(input.joinRequestId), input.resolvedAt);
      }),
      () => undefined,
    );
  }

  async renameHousehold(input: Parameters<AtomicApplicationPersistence["renameHousehold"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId), name: input.name } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const { household } = await this.requireScopeWithRole(tables, String(input.actorId), "leader");
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
              await this.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId), name: input.name }, String(input.householdId), input.occurredAt);
await this.stageAudit(tablesDB, tx, input.auditEvent);
      }),
      () => undefined,
    );;
  }

  async transferLeadership(input: Parameters<AtomicApplicationPersistence["transferLeadership"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId), targetId: String(input.targetId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.auditEvent.occurredAt);
      const { household, memberships, actorMembership } = await this.requireScopeWithRole(tables, String(input.actorId), "leader");

      const target = memberships.find((m) => m.userId === input.targetId && m.status === "active");
      if (!target || target.userId === actorMembership.userId) throw new ApplicationError("NOT_FOUND", "Leadership transfer target not found.");

      await guards.transferOwnership("active-leader", String(household.householdId), String(actorMembership.userId), String(input.targetId));
      await this.stagedMembershipUpdate(tablesDB, tx, { ...actorMembership, role: "member" }, input.auditEvent.occurredAt);
      await this.stagedMembershipUpdate(tablesDB, tx, { ...target, role: "leader" }, input.auditEvent.occurredAt);
      await this.stageAudit(tablesDB, tx, input.auditEvent);

        await this.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId), targetId: String(input.targetId) }, String(input.householdId), input.auditEvent.occurredAt);      }),
      () => undefined,
    );;
  }

  async leaveHousehold(input: Parameters<AtomicApplicationPersistence["leaveHousehold"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.auditEvent.occurredAt);
      const scope = await this.requireScopeWithRole(tables, String(input.actorId), undefined);
      if (scope.actorMembership.role === "leader") {
        throw new ApplicationError("CONFLICT", "Transfer leadership before leaving the household.");
      }
      const context = await this.financialContext(tables, String(scope.household.householdId));
      this.assertExactZeroBalance(context.sheet, String(input.actorId), "leaving");
      this.assertNoPendingSettlement(context.settlements, String(input.actorId), "leaving");

      await guards.release("active-membership", String(input.actorId));
      await this.stagedMembershipUpdate(tablesDB, tx, { ...scope.actorMembership, status: "former" }, input.auditEvent.occurredAt);
      await this.stageAudit(tablesDB, tx, input.auditEvent);

        await this.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId) }, String(input.householdId), input.auditEvent.occurredAt);      }),
      () => undefined,
    );;
  }

  async removeHouseholdMember(input: Parameters<AtomicApplicationPersistence["removeHouseholdMember"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId), targetId: String(input.targetId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.auditEvent.occurredAt);
      await this.requireScopeWithRole(tables, String(input.actorId), "leader");
      const target = (await this.activeMemberships(tables, input.householdId)).find((m) => m.userId === input.targetId);
      if (!target) throw new ApplicationError("NOT_FOUND", "Household member not found.");
      if (target.role === "leader") throw new ApplicationError("CONFLICT", "The House Leader cannot be removed. Transfer leadership first.");
      const context = await this.financialContext(tables, String(input.householdId));
      this.assertExactZeroBalance(context.sheet, String(input.targetId), "removing the member");
      this.assertNoPendingSettlement(context.settlements, String(input.targetId), "removing the member");

      await guards.release("active-membership", String(input.targetId));
      await this.stagedMembershipUpdate(tablesDB, tx, { ...target, status: "former" }, input.auditEvent.occurredAt);
      await this.stageAudit(tablesDB, tx, input.auditEvent);

        await this.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId), targetId: String(input.targetId) }, String(input.householdId), input.auditEvent.occurredAt);      }),
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
    const tablesDB = this.tablesDB;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { householdId: String(input.householdId) } },
      async () =>
      runCommandTransaction(tablesDB, async ({ tx }) => {
      const tables = this.scoped(tablesDB, tx);
      const guards = new CommandGuardEngine(tablesDB, tx, input.auditEvent.occurredAt);
      const { household, memberships } = await this.requireScopeWithRole(tables, String(input.actorId), "leader");

      const context = await this.financialContext(tables, String(household.householdId));
      for (const member of memberships) {
        this.assertExactZeroBalance(context.sheet, String(member.userId), "deleting the household");
      }
      this.assertNoPendingSettlement(context.settlements, null, "deleting the household");

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
        await this.stagedMembershipUpdate(tablesDB, tx, { ...member, status: "former" }, input.auditEvent.occurredAt);
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
        await this.stagedRequestUpdate(tablesDB, tx, { ...request, status: "household-closed", resolvedAt: input.auditEvent.occurredAt, resolvedByUserId: input.actorId });
        await this.stageAudit(tablesDB, tx, closureAudit);
      }

      await this.stageAudit(tablesDB, tx, input.auditEvent);
      await this.stageEnvelopeOutcome(tablesDB, tx, String(input.actorId), { householdId: String(input.householdId) }, String(input.householdId), input.auditEvent.occurredAt);
      this.lastDeleteStagedOperations = tx.stagedOperations();
      }),
      () => undefined,
    );
  }

  // -- R3+ placeholders (intentionally unavailable until authorized) --------

  private unavailable(): never {
    throw new ApplicationError("PERSISTENCE_FAILURE", "This command plane arrives with a later production slice.");
  }

  updateCurrentProfile(): Promise<void> { return this.unavailable(); }
  createExpense(): Promise<string> { return this.unavailable(); }
  editExpense(): Promise<void> { return this.unavailable(); }
  createSettlement(): Promise<string> { return this.unavailable(); }
  transitionSettlement(): Promise<void> { return this.unavailable(); }
  createCard(): Promise<string> { return this.unavailable(); }
  updateCard(): Promise<void> { return this.unavailable(); }
  removeCard(): Promise<never> { return this.unavailable(); }
  createReceipt(): Promise<string> { return this.unavailable(); }
  deleteReceipt(): Promise<void> { return this.unavailable(); }
}
