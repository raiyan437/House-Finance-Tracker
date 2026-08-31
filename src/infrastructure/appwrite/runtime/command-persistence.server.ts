import "server-only";
import type { TablesDB } from "node-appwrite";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { ApplicationError } from "@/application/errors/application-error";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import type { HouseholdBalanceSheet } from "@/domain/balances/balance-types";
import { toBalanceExpense } from "@/domain/records/domain-records";
import { canonicalIntentDigest } from "@/application/idempotency/command-idempotency";
import {
  assertExpense,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  type AuditEvent,
  type Card,
  type Expense,
  type ExpenseCardPrivateSnapshot,
  type Household,
  type JoinRequest,
} from "@/domain/records/domain-records";
import type { CardRemovalResult } from "@/domain/cards/card-lifecycle";
import type { BackdatedExpenseConfirmationAuthority } from "@/application/expenses/backdated-expense-confirmation";
import {
  expenseRelevantIntentDigest,
  LOCAL_BACKDATED_CONFIRMATION_AUTHORITY,
  type BackdatedExpenseConfirmationPayload,
} from "@/application/expenses/backdated-expense-confirmation";
import { BackdatedExpenseConfirmationRequiredError } from "@/application/errors/application-error";
import { assertHouseholdFinancialState } from "@/domain/balances/household-financial-state";
import { assertExpenseDateNotInFuture } from "@/domain/dates/business-calendar";
import { isBackdatedAfterSettlement, latestConfirmedSettlementBefore } from "@/domain/expenses/backdated-expense-policy";
import {
  assertConfirmedSettlementFinancialChangeAllowed,
  latestConfirmedSettlementAt,
} from "@/domain/expenses/confirmed-settlement-financial-lock";
import {
  assertFormerMemberChangeAllowed,
  assertLegacyPercentageChangeAllowed,
  expenseFinancialFingerprintsEqual,
  type ExpenseFinancialFingerprint,
} from "@/domain/expenses/expense-financial-fingerprint";
import { assertCanEditExpense, getExpensePermissions } from "@/domain/permissions/expense-permissions";
import { DomainError } from "@/domain/shared/domain-error";
import type { HouseholdId } from "@/domain/shared/identifiers";
import { auditEventId } from "@/domain/shared/identifiers";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { createPendingSettlement } from "@/domain/settlements/pending-settlement-policy";
import { cancelSettlement, confirmSettlement, rejectSettlement } from "@/domain/settlements/settlement-lifecycle";
import { commandOutcomeRowId, membershipRowId } from "../ids";
import { mapCard, mapExpense, mapHousehold, mapJoinRequest, mapMembership, mapPrivateExpenseCard, mapProfileDisplay, mapSettlement } from "../reads/mappers.server";
import { settlementPairKey } from "../reads/read-repositories.server";
import { createTablesReader, type TablesReader } from "../reads/tables.server";
import { runCommandTransaction, type CommandTransaction } from "./tx-runner.server";
import { TransactionFailure } from "./tx-errors.server";
import { currentCommandEnvelope } from "./command-envelope.server";
import { CommandGuardEngine } from "./guards.server";

const TABLE = {
  profiles: "profiles",
  households: "households",
  memberships: "memberships",
  joinRequests: "join_requests",
  expenses: "expenses",
  settlements: "settlements",
  auditEvents: "audit_events",
  commandOutcomes: "command_outcomes",
  cards: "cards",
  expenseCardPrivateDetails: "expense_card_private_details",
} as const;

const MAX_ACTIVE_HOUSEHOLD_MEMBERS = 4;

function expenseFingerprint(expense: Expense, cardAssociationIdentity?: string): ExpenseFinancialFingerprint {
  return {
    householdId: expense.householdId,
    amount: expense.amount,
    payerId: expense.payerId,
    splitMethod: expense.splitMethod,
    percentageEntries: expense.percentageEntries,
    allocations: expense.allocations,
    expenseDate: expense.expenseDate,
    payment: expense.payment,
    ...(expense.payment.method === "card" ? { cardAssociationIdentity } : {}),
    deleted: Boolean(expense.deletedAt),
  };
}

function privateCardSnapshot(expense: Expense, card: Card): ExpenseCardPrivateSnapshot {
  return {
    expenseId: expense.expenseId,
    ownerId: expense.creatorId,
    cardId: card.cardId,
    cardName: card.name,
    cardType: card.type,
    colorId: card.colorId,
  };
}

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
  readonly lastR3StagedOperations: Partial<Record<string, number>> = {};

  constructor(
    private readonly tablesDB: TablesDB,
    private readonly backdatedConfirmationAuthority?: BackdatedExpenseConfirmationAuthority,
  ) {}

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

  private async householdMemberships(tables: TablesReader, householdId: string): Promise<readonly MembershipSnapshot[]> {
    return (await tables.listRows(TABLE.memberships, [])).map(mapMembership)
      .filter((membership) => String(membership.householdId) === householdId);
  }

  private assertExpenseParticipants(
    expense: Expense,
    memberships: readonly MembershipSnapshot[],
    requireActive: boolean,
  ): void {
    const byUser = new Map(memberships.map((membership) => [String(membership.userId), membership]));
    for (const allocation of expense.allocations) {
      const membership = byUser.get(String(allocation.participantId));
      if (!membership || (requireActive && membership.status !== "active")) {
        throw new DomainError("INVALID_EXPENSE", requireActive
          ? "New Expense participants must be active Household members."
          : "Expense participants must belong to Household history.");
      }
    }
  }

  private expenseRowData(expense: Expense): Record<string, unknown> {
    return {
      householdId: String(expense.householdId),
      expenseDate: expense.expenseDate,
      amountPoisha: expense.amount,
      payerId: String(expense.payerId),
      splitMethod: expense.splitMethod,
      name: expense.name,
      paymentMethod: expense.payment.method,
      paymentRefJson: JSON.stringify({ private: expense.payment.method === "card" }),
      allocationsJson: JSON.stringify(expense.allocations.map((allocation) => ({
        participantId: String(allocation.participantId),
        sharePoisha: allocation.share,
      }))),
      percentageEntriesJson: expense.percentageEntries
        ? JSON.stringify(expense.percentageEntries.map((entry) => ({ participantId: String(entry.participantId), basisPoints: entry.basisPoints })))
        : null,
      revision: expense.revision,
      createdBy: String(expense.creatorId),
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      deletedAt: expense.deletedAt ?? null,
      deletedByUserId: expense.deletedByUserId ? String(expense.deletedByUserId) : null,
    };
  }

  private async stagePrivateCardSnapshot(
    tablesDB: TablesDB,
    tx: CommandTransaction,
    snapshot: ExpenseCardPrivateSnapshot,
    createdAt: string,
    replace: boolean,
  ): Promise<void> {
    const operation = replace ? tablesDB.upsertRow.bind(tablesDB) : tablesDB.createRow.bind(tablesDB);
    await operation({
      databaseId: "hft",
      tableId: TABLE.expenseCardPrivateDetails,
      rowId: String(snapshot.expenseId),
      data: {
        ownerId: String(snapshot.ownerId),
        cardId: String(snapshot.cardId),
        cardName: snapshot.cardName,
        snapshotJson: JSON.stringify({ cardType: snapshot.cardType, colorId: snapshot.colorId }),
        createdAt,
      },
      transactionId: tx.id,
    });
    tx.recordStagedOperation();
  }

  private requireBackdatedConfirmation(
    payload: BackdatedExpenseConfirmationPayload,
    providedToken: string | undefined,
  ): void {
    const authority = this.backdatedConfirmationAuthority ?? LOCAL_BACKDATED_CONFIRMATION_AUTHORITY;
    if (!providedToken || !authority.verify(providedToken, payload)) {
      throw new BackdatedExpenseConfirmationRequiredError(authority.issue(payload));
    }
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
    const memberships = membershipRows.map(mapMembership)
      .filter((membership) => String(membership.householdId) === householdId);
    const expenses = expenseRows.map(mapExpense).filter((e) => e.householdId === householdId);
    const settlements = settlementRows.map(mapSettlement).filter((s) => s.householdId === householdId);
    return {
      memberships,
      expenses,
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
    _intentSeed: Record<string, unknown>,
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
        intentDigest: canonicalIntentDigest(envelope.intentSeed),
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

      await guards.touch("financial", String(household.householdId));
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

      await guards.touch("financial", String(household.householdId));
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

      await guards.touch("financial", String(scope.household.householdId));
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

      await guards.touch("financial", String(input.householdId));
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

  // -- R3C/R3D: exact Expense writes ----------------------------------------

  async createExpense(input: Parameters<AtomicApplicationPersistence["createExpense"]>[0]): Promise<string> {
    const tablesDB = this.tablesDB;
    const actorId = input.actorId ?? input.expense.creatorId;
    const activeCommandId = input.commandId ?? input.idempotency.commandId;
    const expense = input.expense;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(actorId), intentSeed: {} },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.scoped(tablesDB, tx);
        assertExpense(expense);
        assertExpenseDateNotInFuture(expense.expenseDate, expense.createdAt);
        if (input.receipts.length > 0) {
          throw new ApplicationError("COMMANDS_UNAVAILABLE", "Receipt uploads arrive in the receipt production phase.");
        }
        if (
          actorId !== expense.creatorId || actorId !== expense.payerId ||
          input.auditEvent.actorId !== actorId || input.auditEvent.householdId !== expense.householdId ||
          input.auditEvent.aggregateId !== expense.expenseId ||
          expense.revision !== 1 || expense.createdAt !== expense.updatedAt ||
          input.auditEvent.occurredAt !== expense.createdAt ||
          input.idempotency.actorId !== actorId || input.idempotency.commandType !== "create-expense" ||
          input.idempotency.commandId !== activeCommandId ||
          (expense.payment.method === "card") !== Boolean(input.selectedCardId)
        ) {
          throw new ApplicationError("CONFLICT", "Expense command identity or lifecycle metadata is inconsistent.");
        }
        await this.getAliveHousehold(tables, String(expense.householdId));
        const memberships = await this.householdMemberships(tables, String(expense.householdId));
        const actorMembership = memberships.find((membership) => membership.userId === actorId && membership.status === "active");
        if (!actorMembership) throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The Expense creator is no longer an active Household member.");
        this.assertExpenseParticipants(expense, memberships, true);
        if (await tables.getRow(TABLE.expenses, String(expense.expenseId))) {
          throw new ApplicationError("CONFLICT", "Expense already exists.");
        }
        const [expenseRows, settlementRows] = await Promise.all([
          tables.listRows(TABLE.expenses, []),
          tables.listRows(TABLE.settlements, []),
        ]);
        const expenses = expenseRows.map(mapExpense).filter((candidate) => candidate.householdId === expense.householdId);
        const settlements = settlementRows.map(mapSettlement).filter((candidate) => candidate.householdId === expense.householdId);
        const recomputedIntentDigest = expenseRelevantIntentDigest({
          amount: expense.amount,
          expenseDate: expense.expenseDate,
          splitMethod: expense.splitMethod,
          percentageEntries: expense.percentageEntries,
          allocations: expense.allocations,
          paymentMethod: expense.payment.method,
          ...(input.selectedCardId ? { cardAssociationIdentity: input.selectedCardId } : {}),
        });
        if (input.relevantIntentDigest !== undefined && input.relevantIntentDigest !== recomputedIntentDigest) {
          throw new ApplicationError("CONFLICT", "Expense confirmation intent is inconsistent.");
        }
        const boundary = latestConfirmedSettlementBefore(expense.householdId, expense.createdAt, settlements);
        if (isBackdatedAfterSettlement(expense.expenseDate, boundary)) {
          this.requireBackdatedConfirmation({
            actorId,
            commandType: "create-expense",
            commandId: activeCommandId,
            relevantIntentDigest: recomputedIntentDigest,
            proposedExpenseDate: expense.expenseDate,
            qualifyingSettlementId: boundary!.settlementId,
            qualifyingSettlementResolvedAt: boundary!.resolvedAt,
          }, input.backdatedConfirmationToken);
        }

        const guards = new CommandGuardEngine(tablesDB, tx, expense.createdAt);
        await guards.touch("financial", String(expense.householdId));
        let snapshot: ExpenseCardPrivateSnapshot | undefined;
        if (input.selectedCardId) {
          await guards.touch("card", String(input.selectedCardId), String(actorId));
          const cardRaw = await tables.getRow(TABLE.cards, String(input.selectedCardId));
          const card = cardRaw ? mapCard(cardRaw) : undefined;
          if (!card || card.ownerId !== actorId || card.archivedAt) {
            throw new ApplicationError("NOT_FOUND", "Selectable Card not found.");
          }
          snapshot = privateCardSnapshot(expense, card);
        }
        assertHouseholdFinancialState(
          expense.householdId,
          memberships,
          [...expenses, expense],
          settlements,
        );
        await tablesDB.createRow({
          databaseId: "hft",
          tableId: TABLE.expenses,
          rowId: String(expense.expenseId),
          data: this.expenseRowData(expense),
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        if (snapshot) await this.stagePrivateCardSnapshot(tablesDB, tx, snapshot, expense.createdAt, false);
        await this.stageAudit(tablesDB, tx, input.auditEvent);
        await this.stageOutcome(tablesDB, tx, input.idempotency, String(expense.expenseId), expense.createdAt);
        this.lastR3StagedOperations.createExpense = tx.stagedOperations();
        return String(expense.expenseId);
      }),
      (resourceId) => resourceId,
      input.idempotency,
    );
  }

  async editExpense(input: Parameters<AtomicApplicationPersistence["editExpense"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    const actorId = input.actorId ?? input.auditEvents[0]?.actorId;
    if (!actorId) throw new ApplicationError("CONFLICT", "Expense command actor is missing.");
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(actorId), intentSeed: {} },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.scoped(tablesDB, tx);
        if ((input.receiptAdditions?.length ?? 0) > 0 || (input.receiptRemovals?.length ?? 0) > 0) {
          throw new ApplicationError("COMMANDS_UNAVAILABLE", "Receipt mutations arrive in the receipt production phase.");
        }
        const raw = await tables.getRow(TABLE.expenses, String(input.expectedExpenseId));
        const current = raw ? mapExpense(raw) : undefined;
        if (!current || current.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found.");
        if (current.revision !== input.expectedRevision) {
          throw new ApplicationError("EXPENSE_VERSION_CONFLICT", "This Expense changed while you were editing it.");
        }
        const proposed = input.expense;
        assertExpense(proposed);
        if (
          proposed.revision !== current.revision + 1 ||
          proposed.expenseId !== current.expenseId || proposed.householdId !== current.householdId ||
          proposed.creatorId !== current.creatorId || proposed.payerId !== current.payerId ||
          proposed.createdAt !== current.createdAt ||
          input.auditEvents.length !== 1 || input.auditEvents[0]?.actorId !== actorId ||
          input.auditEvents[0]?.householdId !== current.householdId ||
          input.auditEvents[0]?.aggregateId !== current.expenseId ||
          input.auditEvents[0]?.occurredAt !== proposed.updatedAt
        ) {
          throw new ApplicationError("CONFLICT", "Expense identity, revision, or audit metadata is inconsistent.");
        }
        await this.getAliveHousehold(tables, String(current.householdId));
        const memberships = await this.householdMemberships(tables, String(current.householdId));
        const permissions = getExpensePermissions(current.householdId, actorId, current.creatorId, memberships);
        assertCanEditExpense(permissions);
        this.assertExpenseParticipants(proposed, memberships, false);

        const [expenseRows, settlementRows, existingSnapshotRaw] = await Promise.all([
          tables.listRows(TABLE.expenses, []),
          tables.listRows(TABLE.settlements, []),
          tables.getRow(TABLE.expenseCardPrivateDetails, String(current.expenseId)),
        ]);
        const settlements = settlementRows.map(mapSettlement).filter((candidate) => candidate.householdId === current.householdId);
        const existingSnapshot = existingSnapshotRaw ? mapPrivateExpenseCard(existingSnapshotRaw) : undefined;
        if (current.payment.method === "card" && (!existingSnapshot || existingSnapshot.ownerId !== current.creatorId)) {
          throw new ApplicationError("PERSISTENCE_FAILURE", "Card Expense history is unavailable.");
        }
        const currentCardId = existingSnapshot?.cardId;
        let proposedCardId = proposed.payment.method === "card" ? currentCardId : undefined;
        let newSnapshot: ExpenseCardPrivateSnapshot | undefined;
        if (input.selectedCardId) {
          if (actorId !== current.creatorId || proposed.payment.method !== "card") {
            throw new ApplicationError("NOT_FOUND", "Selectable Card not found.");
          }
          proposedCardId = input.selectedCardId;
        }
        if (proposed.payment.method === "card" && !proposedCardId) {
          throw new ApplicationError("CONFLICT", "A Card Expense requires a private Card association.");
        }
        const currentFingerprint = expenseFingerprint(current, currentCardId);
        const proposedFingerprint = expenseFingerprint(proposed, proposedCardId);
        assertConfirmedSettlementFinancialChangeAllowed(
          currentFingerprint,
          proposedFingerprint,
          current.createdAt,
          latestConfirmedSettlementAt(current.householdId, settlements),
        );
        assertFormerMemberChangeAllowed(currentFingerprint, proposedFingerprint, memberships);
        assertLegacyPercentageChangeAllowed(currentFingerprint, proposedFingerprint);
        const financialChanged = !expenseFinancialFingerprintsEqual(currentFingerprint, proposedFingerprint);
        if (financialChanged) assertExpenseDateNotInFuture(proposed.expenseDate, proposed.updatedAt);
        const recomputedIntentDigest = expenseRelevantIntentDigest({
          amount: proposed.amount,
          expenseDate: proposed.expenseDate,
          splitMethod: proposed.splitMethod,
          percentageEntries: proposed.percentageEntries,
          allocations: proposed.allocations,
          paymentMethod: proposed.payment.method,
          ...(proposed.payment.method === "card"
            ? { cardAssociationIdentity: actorId === current.creatorId ? proposedCardId : "preserved-private-card" }
            : {}),
        });
        if (input.relevantIntentDigest !== undefined && input.relevantIntentDigest !== recomputedIntentDigest) {
          throw new ApplicationError("CONFLICT", "Expense confirmation intent is inconsistent.");
        }
        if (financialChanged && input.backdatedConfirmationApplicable) {
          const boundary = latestConfirmedSettlementBefore(current.householdId, proposed.updatedAt, settlements);
          if (isBackdatedAfterSettlement(proposed.expenseDate, boundary)) {
            this.requireBackdatedConfirmation({
              actorId,
              commandType: "edit-expense",
              commandId: input.commandId!,
              relevantIntentDigest: recomputedIntentDigest,
              proposedExpenseDate: proposed.expenseDate,
              qualifyingSettlementId: boundary!.settlementId,
              qualifyingSettlementResolvedAt: boundary!.resolvedAt,
            }, input.backdatedConfirmationToken);
          }
        }

        const guards = new CommandGuardEngine(tablesDB, tx, proposed.updatedAt);
        await guards.touch("financial", String(current.householdId));
        const cardIds = [...new Set([currentCardId, proposedCardId].filter((value): value is NonNullable<typeof value> => value !== undefined))]
          .sort((left, right) => String(left).localeCompare(String(right)));
        for (const cardIdValue of cardIds) {
          await guards.touch("card", String(cardIdValue), String(current.creatorId));
        }
        if (input.selectedCardId) {
          const cardRaw = await tables.getRow(TABLE.cards, String(input.selectedCardId));
          const card = cardRaw ? mapCard(cardRaw) : undefined;
          if (!card || card.ownerId !== actorId || card.archivedAt) {
            throw new ApplicationError("NOT_FOUND", "Selectable Card not found.");
          }
          newSnapshot = privateCardSnapshot(proposed, card);
        }
        const expenses = expenseRows.map(mapExpense).filter((candidate) => candidate.householdId === current.householdId)
          .map((candidate) => candidate.expenseId === current.expenseId ? proposed : candidate);
        assertHouseholdFinancialState(current.householdId, memberships, expenses, settlements);
        await tablesDB.updateRow({
          databaseId: "hft",
          tableId: TABLE.expenses,
          rowId: String(current.expenseId),
          data: this.expenseRowData(proposed),
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        if (newSnapshot) await this.stagePrivateCardSnapshot(tablesDB, tx, newSnapshot, proposed.updatedAt, true);
        await this.stageAudit(tablesDB, tx, input.auditEvents[0]!);
        await this.stageEnvelopeOutcome(tablesDB, tx, String(actorId), {}, String(current.expenseId), proposed.updatedAt);
        this.lastR3StagedOperations[proposed.deletedAt ? "deleteExpense" : "editExpense"] = tx.stagedOperations();
      }),
      () => undefined,
    );
  }

  // -- R3B: owner-private Cards ---------------------------------------------

  async createCard(input: Parameters<AtomicApplicationPersistence["createCard"]>[0]): Promise<string> {
    const tablesDB = this.tablesDB;
    const { card, idempotency } = input;
    return this.resolveDelivery(
      tablesDB,
      {
        actorId: String(card.ownerId),
        intentSeed: { name: card.name, type: card.type, colorId: card.colorId },
      },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.scoped(tablesDB, tx);
        if (await tables.getRow(TABLE.cards, String(card.cardId))) {
          throw new ApplicationError("CONFLICT", "Card already exists.");
        }
        const guards = new CommandGuardEngine(tablesDB, tx, card.createdAt);
        await guards.acquire("card", String(card.cardId), String(card.ownerId));
        await tablesDB.createRow({
          databaseId: "hft",
          tableId: TABLE.cards,
          rowId: String(card.cardId),
          data: {
            ownerId: String(card.ownerId),
            name: card.name,
            design: card.colorId,
            type: card.type,
            status: "active",
            archivedAt: null,
            version: 1,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
          },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.stageOutcome(tablesDB, tx, idempotency, String(card.cardId), card.createdAt);
        this.lastR3StagedOperations.createCard = tx.stagedOperations();
        return String(card.cardId);
      }),
      (resourceId) => resourceId,
      idempotency,
    );
  }

  async updateCard(input: Parameters<AtomicApplicationPersistence["updateCard"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    const { card } = input;
    const intentSeed = { cardId: String(card.cardId), name: card.name, type: card.type, colorId: card.colorId };
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(card.ownerId), intentSeed },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.scoped(tablesDB, tx);
        const raw = await tables.getRow(TABLE.cards, String(card.cardId));
        const current = raw ? mapCard(raw) : undefined;
        if (!current || current.ownerId !== card.ownerId || current.archivedAt) {
          throw new ApplicationError("NOT_FOUND", "Card not found.");
        }
        if (current.updatedAt !== input.expectedUpdatedAt) {
          throw new ApplicationError("CONFLICT", "This Card changed while you were editing it.");
        }
        const version = Number(raw?.version);
        if (!Number.isSafeInteger(version) || version < 1) {
          throw new ApplicationError("PERSISTENCE_FAILURE", "Stored Card version is invalid.");
        }
        const guards = new CommandGuardEngine(tablesDB, tx, card.updatedAt);
        await guards.touch("card", String(card.cardId), String(card.ownerId));
        await tablesDB.updateRow({
          databaseId: "hft",
          tableId: TABLE.cards,
          rowId: String(card.cardId),
          data: { name: card.name, design: card.colorId, type: card.type, updatedAt: card.updatedAt, version: version + 1 },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.stageEnvelopeOutcome(tablesDB, tx, String(card.ownerId), intentSeed, String(card.cardId), card.updatedAt);
        this.lastR3StagedOperations.editCard = tx.stagedOperations();
      }),
      () => undefined,
    );
  }

  async removeCard(input: Parameters<AtomicApplicationPersistence["removeCard"]>[0]): Promise<CardRemovalResult> {
    const tablesDB = this.tablesDB;
    const intentSeed = { cardId: String(input.cardId), expectedAction: input.expectedAction };
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(input.ownerId), intentSeed },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.scoped(tablesDB, tx);
        const raw = await tables.getRow(TABLE.cards, String(input.cardId));
        const current = raw ? mapCard(raw) : undefined;
        if (!current || current.ownerId !== input.ownerId || current.archivedAt) {
          throw new ApplicationError("NOT_FOUND", "Card not found.");
        }
        const referenced = (await tables.listRows(TABLE.expenseCardPrivateDetails, []))
          .some((row) => String(row.ownerId) === String(input.ownerId) && String(row.cardId) === String(input.cardId));
        const actualAction = referenced ? "archive" : "delete";
        if (actualAction !== input.expectedAction) {
          throw new ApplicationError("CONFLICT", "Card usage changed. Refresh the removal preview and confirm again.");
        }
        const guards = new CommandGuardEngine(tablesDB, tx, input.occurredAt);
        if (actualAction === "delete") {
          await guards.release("card", String(input.cardId), String(input.ownerId));
          await tablesDB.deleteRow({
            databaseId: "hft",
            tableId: TABLE.cards,
            rowId: String(input.cardId),
            transactionId: tx.id,
          });
          tx.recordStagedOperation();
        } else {
          const version = Number(raw?.version);
          if (!Number.isSafeInteger(version) || version < 1) {
            throw new ApplicationError("PERSISTENCE_FAILURE", "Stored Card version is invalid.");
          }
          await guards.touch("card", String(input.cardId), String(input.ownerId));
          await tablesDB.updateRow({
            databaseId: "hft",
            tableId: TABLE.cards,
            rowId: String(input.cardId),
            data: { status: "archived", archivedAt: input.occurredAt, updatedAt: input.occurredAt, version: version + 1 },
            transactionId: tx.id,
          });
          tx.recordStagedOperation();
        }
        const outcomeResource = `${actualAction}:${String(input.cardId)}`;
        await this.stageEnvelopeOutcome(tablesDB, tx, String(input.ownerId), intentSeed, outcomeResource, input.occurredAt);
        this.lastR3StagedOperations.removeCard = tx.stagedOperations();
        return actualAction === "delete" ? "deleted" : "archived";
      }),
      (resourceId) => {
        const action = resourceId.split(":", 1)[0];
        if (action !== "delete" && action !== "archive") {
          throw new ApplicationError("PERSISTENCE_FAILURE", "Stored Card command outcome is invalid.");
        }
        return action === "delete" ? "deleted" : "archived";
      },
    );
  }

  // -- R3E: exact-recommendation Settlements -------------------------------

  async createSettlement(input: Parameters<AtomicApplicationPersistence["createSettlement"]>[0]): Promise<string> {
    const tablesDB = this.tablesDB;
    const { settlement, auditEvent, idempotency } = input;
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(settlement.senderId), intentSeed: { ...settlement.originatingRecommendation } },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.scoped(tablesDB, tx);
        if (await tables.getRow(TABLE.settlements, String(settlement.settlementId))) {
          throw new ApplicationError("CONFLICT", "Settlement already exists.");
        }
        await this.getAliveHousehold(tables, String(settlement.householdId));
        const context = await this.financialContext(tables, String(settlement.householdId));
        const actorMembership = context.memberships.find((membership) =>
          membership.userId === settlement.senderId && membership.status === "active");
        if (!actorMembership) throw new ApplicationError("NOT_FOUND", "Active household membership not found.");
        const authoritative = createPendingSettlement({
          settlementId: settlement.settlementId,
          householdId: settlement.householdId,
          actorId: settlement.senderId,
          requestedRecommendation: settlement.originatingRecommendation,
          createdAt: settlement.createdAt,
          memberships: context.memberships,
          currentRecommendations: generateSettlementRecommendations(context.sheet),
          existingSettlements: context.settlements,
        });
        if (
          authoritative.senderId !== settlement.senderId ||
          authoritative.receiverId !== settlement.receiverId ||
          authoritative.amount !== settlement.amount ||
          authoritative.status !== "pending" ||
          auditEvent.householdId !== settlement.householdId ||
          auditEvent.actorId !== settlement.senderId ||
          auditEvent.aggregateType !== "settlement" ||
          auditEvent.aggregateId !== settlement.settlementId
        ) {
          throw new ApplicationError("CONFLICT", "Settlement intent or audit metadata is inconsistent.");
        }
        const pairKey = settlementPairKey(settlement.householdId, settlement.senderId, settlement.receiverId);
        const guards = new CommandGuardEngine(tablesDB, tx, settlement.createdAt);
        await guards.touch("financial", String(settlement.householdId));
        await guards.acquire("pending-settlement", pairKey, String(settlement.settlementId));
        await tablesDB.createRow({
          databaseId: "hft",
          tableId: TABLE.settlements,
          rowId: String(settlement.settlementId),
          data: {
            householdId: String(authoritative.householdId),
            senderId: String(authoritative.senderId),
            receiverId: String(authoritative.receiverId),
            amountPoisha: authoritative.amount,
            originalAmountPoisha: authoritative.originatingRecommendation.amount,
            status: "pending",
            pairKey,
            recommendationDigest: canonicalIntentDigest(authoritative.originatingRecommendation),
            resolvedAt: null,
            createdAt: authoritative.createdAt,
          },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.stageAudit(tablesDB, tx, auditEvent);
        await this.stageOutcome(tablesDB, tx, idempotency, String(settlement.settlementId), settlement.createdAt);
        this.lastR3StagedOperations.createSettlement = tx.stagedOperations();
        return String(settlement.settlementId);
      }),
      (resourceId) => resourceId,
      idempotency,
    );
  }

  async transitionSettlement(input: Parameters<AtomicApplicationPersistence["transitionSettlement"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    const proposed = input.settlement;
    const actorId = input.auditEvent.actorId;
    const intentSeed = { settlementId: String(proposed.settlementId), status: proposed.status };
    return this.resolveDelivery(
      tablesDB,
      { actorId: String(actorId), intentSeed },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.scoped(tablesDB, tx);
        const raw = await tables.getRow(TABLE.settlements, String(proposed.settlementId));
        const current = raw ? mapSettlement(raw) : undefined;
        if (!current) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
        await this.getAliveHousehold(tables, String(current.householdId));
        const context = await this.financialContext(tables, String(current.householdId));
        if (!context.memberships.some((membership) => membership.userId === actorId && membership.status === "active")) {
          throw new ApplicationError("NOT_FOUND", "Settlement not found.");
        }
        if (current.status !== input.expectedStatus || input.expectedStatus !== "pending") {
          throw new ApplicationError("CONFLICT", "Settlement is no longer Pending.");
        }
        if (proposed.status === "pending" || !proposed.resolvedAt) {
          throw new ApplicationError("CONFLICT", "Settlement transition is inconsistent.");
        }
        const authoritative = proposed.status === "confirmed"
          ? confirmSettlement(current, actorId, proposed.resolvedAt)
          : proposed.status === "rejected"
            ? rejectSettlement(current, actorId, proposed.resolvedAt)
            : cancelSettlement(current, actorId, proposed.resolvedAt);
        if (
          authoritative.householdId !== proposed.householdId ||
          authoritative.senderId !== proposed.senderId ||
          authoritative.receiverId !== proposed.receiverId ||
          authoritative.amount !== proposed.amount ||
          authoritative.status !== proposed.status ||
          input.auditEvent.householdId !== current.householdId ||
          input.auditEvent.aggregateType !== "settlement" ||
          input.auditEvent.aggregateId !== current.settlementId
        ) {
          throw new ApplicationError("CONFLICT", "Settlement transition metadata is inconsistent.");
        }
        const pairKey = settlementPairKey(current.householdId, current.senderId, current.receiverId);
        const guards = new CommandGuardEngine(tablesDB, tx, proposed.resolvedAt);
        await guards.touch("financial", String(current.householdId));
        await guards.release("pending-settlement", pairKey, String(current.settlementId));
        await tablesDB.updateRow({
          databaseId: "hft",
          tableId: TABLE.settlements,
          rowId: String(current.settlementId),
          data: { status: authoritative.status, resolvedAt: authoritative.resolvedAt },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.stageAudit(tablesDB, tx, input.auditEvent);
        await this.stageEnvelopeOutcome(tablesDB, tx, String(actorId), intentSeed, String(current.settlementId), proposed.resolvedAt);
        this.lastR3StagedOperations[`settlement-${authoritative.status}`] = tx.stagedOperations();
      }),
      () => undefined,
    );
  }

  // -- v1.1 Profile Display Name ------------------------------------------

  async updateCurrentProfile(input: Parameters<AtomicApplicationPersistence["updateCurrentProfile"]>[0]): Promise<void> {
    const tablesDB = this.tablesDB;
    if (input.displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      throw new ApplicationError("INVALID_INPUT", "Display name must be 20 characters or fewer.");
    }
    if (
      input.idempotency.actorId !== input.actorId ||
      input.idempotency.commandType !== "update-profile-display-name" ||
      input.displayName.length === 0 ||
      input.displayName.trim() !== input.displayName
    ) {
      throw new ApplicationError("INVALID_INPUT", "The Display Name command is invalid.");
    }
    await this.resolveDelivery(
      tablesDB,
      { actorId: String(input.actorId), intentSeed: { displayName: input.displayName } },
      () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.scoped(tablesDB, tx);
        const raw = await tables.getRow(TABLE.profiles, String(input.actorId));
        if (!raw) throw new ApplicationError("NOT_FOUND", "Profile not found.");
        const current = mapProfileDisplay(raw);
        if (current.displayName === input.displayName) return;
        if (current.version !== input.expectedVersion) {
          throw new ApplicationError("PROFILE_VERSION_CONFLICT", "This Profile changed while you were editing it.");
        }
        await tablesDB.updateRow({
          databaseId: "hft",
          tableId: TABLE.profiles,
          rowId: String(input.actorId),
          data: { displayName: input.displayName, version: current.version + 1, updatedAt: input.occurredAt },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.stageOutcome(tablesDB, tx, input.idempotency, String(input.actorId), input.occurredAt);
      }),
      () => undefined,
      input.idempotency,
    );
  }

  // -- R4 placeholders -----------------------------------------------------

  private unavailable(): never {
    throw new ApplicationError("PERSISTENCE_FAILURE", "This command plane arrives with a later production slice.");
  }

  createReceipt(): Promise<string> { return this.unavailable(); }
  deleteReceipt(): Promise<void> { return this.unavailable(); }
}
