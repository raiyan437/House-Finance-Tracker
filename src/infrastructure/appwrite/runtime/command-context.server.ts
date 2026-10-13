import "server-only";
import type { TablesDB } from "node-appwrite";
import { ApplicationError } from "@/application/errors/application-error";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import type { HouseholdBalanceSheet } from "@/domain/balances/balance-types";
import { toBalanceExpense } from "@/domain/records/domain-records";
import { canonicalIntentDigest } from "@/application/idempotency/command-idempotency";
import { type AuditEvent, type Card, type Expense, type ExpenseCardPrivateSnapshot, type Household, type JoinRequest } from "@/domain/records/domain-records";
import type { BackdatedExpenseConfirmationAuthority } from "@/application/expenses/backdated-expense-confirmation";
import { LOCAL_BACKDATED_CONFIRMATION_AUTHORITY, type BackdatedExpenseConfirmationPayload } from "@/application/expenses/backdated-expense-confirmation";
import { BackdatedExpenseConfirmationRequiredError } from "@/application/errors/application-error";
import { type ExpenseFinancialFingerprint } from "@/domain/expenses/expense-financial-fingerprint";
import { DomainError } from "@/domain/shared/domain-error";
import type { HouseholdId } from "@/domain/shared/identifiers";

import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { commandOutcomeRowId, membershipRowId } from "../ids";
import { mapExpense, mapHousehold, mapMembership, mapProfileDisplay, mapSettlement } from "../reads/mappers.server";
import { createTablesReader, type TablesReader } from "../reads/tables.server";
import { type CommandTransaction } from "./tx-runner.server";
import { TransactionFailure } from "./tx-errors.server";
import { currentCommandEnvelope } from "./command-envelope.server";
import { notificationDraft, uniqueActiveRecipients } from "@/application/notifications/notification-policy";
import type { Notification } from "@/domain/notifications/notification-types";
import { mapNotification } from "../reads/mappers.server";

export const TABLE = {
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
  expenseComments: "expense_comments",
  notifications: "notifications",
} as const;

export const MAX_ACTIVE_HOUSEHOLD_MEMBERS = 4;

export function expenseFingerprint(expense: Expense, cardAssociationIdentity?: string): ExpenseFinancialFingerprint {
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

export function privateCardSnapshot(expense: Expense, card: Card): ExpenseCardPrivateSnapshot {
  return {
    expenseId: expense.expenseId,
    ownerId: expense.creatorId,
    cardId: card.cardId,
    cardName: card.name,
    cardType: card.type,
    colorId: card.colorId,
  };
}

export interface HouseholdScope {
  readonly household: Household;
  readonly memberships: readonly MembershipSnapshot[];
  readonly actorMembership: MembershipSnapshot;
}

/** Internal per-adapter state; never exposed through the public persistence facade. */
export class AppwriteCommandContext {
constructor(
    readonly tablesDB: TablesDB,
    readonly backdatedConfirmationAuthority?: BackdatedExpenseConfirmationAuthority,
  ) {}

/** Measured staged-write count of the most recent deleteHousehold execution. */
  lastDeleteStagedOperations = 0;

readonly lastR3StagedOperations: Partial<Record<string, number>> = {};

// -- shared helpers -------------------------------------------------------

  scoped(tablesDB: TablesDB, tx: CommandTransaction): TablesReader {
    return createTablesReader(tablesDB, { transactionId: tx.id });
  }

async stageAudit(tablesDB: TablesDB, tx: CommandTransaction, audit: AuditEvent): Promise<void> {
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

async stageOutcome(
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

async getAliveHousehold(tables: TablesReader, id: string): Promise<Household> {
    const row = await tables.getRow(TABLE.households, id);
    const household = row ? mapHousehold(row) : undefined;
    if (!household || household.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
    return household;
  }

async activeMemberships(tables: TablesReader, householdId?: string): Promise<readonly MembershipSnapshot[]> {
    const rows = await tables.listRows(TABLE.memberships, []);
    return rows.map(mapMembership).filter((m) => m.status === "active" && (householdId === undefined || m.householdId === householdId));
  }

async householdMemberships(tables: TablesReader, householdId: string): Promise<readonly MembershipSnapshot[]> {
    return (await tables.listRows(TABLE.memberships, [])).map(mapMembership)
      .filter((membership) => String(membership.householdId) === householdId);
  }

assertExpenseParticipants(
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

expenseRowData(expense: Expense): Record<string, unknown> {
    return {
      householdId: String(expense.householdId),
      expenseDate: expense.expenseDate,
      amountPoisha: expense.amount,
      payerId: String(expense.payerId),
      splitMethod: expense.splitMethod,
      name: expense.name,
      iconCategory: expense.iconCategory ?? "others",
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

async stagePrivateCardSnapshot(
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

requireBackdatedConfirmation(
    payload: BackdatedExpenseConfirmationPayload,
    providedToken: string | undefined,
  ): void {
    const authority = this.backdatedConfirmationAuthority ?? LOCAL_BACKDATED_CONFIRMATION_AUTHORITY;
    if (!providedToken || !authority.verify(providedToken, payload)) {
      throw new BackdatedExpenseConfirmationRequiredError(authority.issue(payload));
    }
  }

async requireScopeWithRole(tables: TablesReader, actorId: string, role: "leader" | undefined): Promise<HouseholdScope> {
    const allActive = await this.activeMemberships(tables);
    const actorMembership = allActive.find((m) => m.userId === actorId);
    if (!actorMembership) throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "You are no longer an active household member.");
    if (role === "leader" && actorMembership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household not found.");
    const household = await this.getAliveHousehold(tables, String(actorMembership.householdId));
    const memberships = allActive.filter((m) => m.householdId === household.householdId);
    return { household, memberships, actorMembership };
  }

async financialContext(tables: TablesReader, householdId: string) {
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

assertExactZeroBalance(sheet: HouseholdBalanceSheet, userId: string, actionLabel: string): void {
    const balance = sheet.balances.find((entry: { memberId: unknown; balance: number }) => String(entry.memberId) === userId);
    if (!balance || Number(balance.balance) !== 0) {
      throw new ApplicationError("CONFLICT", `The exact balance must be zero before ${actionLabel}.`);
    }
  }

assertNoPendingSettlement(settlements: readonly SettlementRecord[], userId: string | null, actionLabel: string): void {
    const pending = settlements.find(
      (settlement) =>
        settlement.status === "pending" &&
        (userId === null || String(settlement.senderId) === userId || String(settlement.receiverId) === userId),
    );
    if (pending) throw new ApplicationError("CONFLICT", `All Pending settlements must be resolved before ${actionLabel}.`);
  }

async stagedRequestUpdate(tablesDB: TablesDB, tx: CommandTransaction, request: JoinRequest): Promise<void> {
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

async stagedMembershipUpdate(tablesDB: TablesDB, tx: CommandTransaction, membership: MembershipSnapshot, instant: string): Promise<void> {
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
  async findCommittedOutcome(
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
  async resolveDelivery<T>(
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
  async stageEnvelopeOutcome(
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

async stageNotifications(tablesDB: TablesDB, tx: CommandTransaction, rows: readonly Notification[]): Promise<void> {
    const tables = this.scoped(tablesDB, tx);
    for (const row of rows) {
      const existing = await tables.getRow(TABLE.notifications, String(row.notificationId));
      if (existing) {
        const current = mapNotification(existing);
        if (current.recipientUserId === row.recipientUserId && current.type === row.type && current.body === row.body && current.createdAt === row.createdAt) continue;
        throw new ApplicationError("CONFLICT", "Notification identity was reused with different content.");
      }
      await tablesDB.createRow({ databaseId: "hft", tableId: TABLE.notifications, rowId: String(row.notificationId), data: { recipientUserId: String(row.recipientUserId), householdId: row.householdId ? String(row.householdId) : null, scope: row.scope, type: row.type, title: row.title, body: row.body, entityType: row.entityType ?? null, entityId: row.entityId ?? null, createdAt: row.createdAt, readAt: row.readAt ?? null }, transactionId: tx.id });
      tx.recordStagedOperation();
    }
  }

async notificationName(tables: TablesReader, userIdValue: string): Promise<string> {
    const row = await tables.getRow(TABLE.profiles, userIdValue);
    return row ? mapProfileDisplay(row).displayName : "A household member";
  }

householdNotifications(input: Readonly<{ eventKey: string; actorId?: string; householdId: string; type: Parameters<typeof notificationDraft>[0]["type"]; title: string; body: string; createdAt: string; entityType?: Parameters<typeof notificationDraft>[0]["entityType"]; entityId?: string; memberships: readonly MembershipSnapshot[] }>): readonly Notification[] {
    return uniqueActiveRecipients(input.memberships, input.actorId as never).map((recipientUserId) => notificationDraft({ ...input, recipientUserId: recipientUserId as never, householdId: input.householdId as never, createdAt: input.createdAt as never }));
  }

unavailable(): never {
    throw new ApplicationError("PERSISTENCE_FAILURE", "This command plane arrives with a later production slice.");
  }
}
