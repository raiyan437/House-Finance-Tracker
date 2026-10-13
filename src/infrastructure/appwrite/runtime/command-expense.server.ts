import "server-only";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { ApplicationError } from "@/application/errors/application-error";
import { assertExpense, assertExpenseComment, type ExpenseCardPrivateSnapshot } from "@/domain/records/domain-records";
import { expenseRelevantIntentDigest } from "@/application/expenses/backdated-expense-confirmation";
import { assertHouseholdFinancialState } from "@/domain/balances/household-financial-state";
import { assertExpenseDateWithinEntryWindow } from "@/domain/dates/business-calendar";
import { isBackdatedAfterSettlement, latestConfirmedSettlementBefore } from "@/domain/expenses/backdated-expense-policy";
import { assertConfirmedSettlementFinancialChangeAllowed, latestConfirmedSettlementAt } from "@/domain/expenses/confirmed-settlement-financial-lock";
import { assertFormerMemberChangeAllowed, assertLegacyPercentageChangeAllowed, expenseFinancialFingerprintsEqual } from "@/domain/expenses/expense-financial-fingerprint";
import { assertCanEditExpense, getExpensePermissions } from "@/domain/permissions/expense-permissions";

import { mapCard, mapExpense, mapHousehold, mapPrivateExpenseCard, mapSettlement } from "../reads/mappers.server";
import { runCommandTransaction } from "./tx-runner.server";
import { CommandGuardEngine } from "./guards.server";
import { expenseCommentRecipients, notificationDraft, formatNotificationBdt } from "@/application/notifications/notification-policy";
import { AppwriteCommandContext, TABLE, expenseFingerprint, privateCardSnapshot } from "./command-context.server";

/** expense commands retain their original complete transaction boundaries. */
export class AppwriteExpenseCommands implements Pick<AtomicApplicationPersistence, "createExpense" | "editExpense" | "createExpenseComment"> {
  constructor(private readonly context: AppwriteCommandContext) {}

// -- R3C/R3D: exact Expense writes ----------------------------------------

  async createExpense(input: Parameters<AtomicApplicationPersistence["createExpense"]>[0]): Promise<string> {
    const tablesDB = this.context.tablesDB;
    const actorId = input.actorId ?? input.expense.creatorId;
    const activeCommandId = input.commandId ?? input.idempotency.commandId;
    const expense = input.expense;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(actorId), intentSeed: {} },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
        assertExpense(expense);
        assertExpenseDateWithinEntryWindow(expense.expenseDate, expense.createdAt);
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
        await this.context.getAliveHousehold(tables, String(expense.householdId));
        const memberships = await this.context.householdMemberships(tables, String(expense.householdId));
        const actorMembership = memberships.find((membership) => membership.userId === actorId && membership.status === "active");
        if (!actorMembership) throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The Expense creator is no longer an active Household member.");
        this.context.assertExpenseParticipants(expense, memberships, true);
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
          this.context.requireBackdatedConfirmation({
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
          data: this.context.expenseRowData(expense),
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        if (snapshot) await this.context.stagePrivateCardSnapshot(tablesDB, tx, snapshot, expense.createdAt, false);
        await this.context.stageAudit(tablesDB, tx, input.auditEvent);
        const expenseName = await this.context.notificationName(tables, String(actorId));
        await this.context.stageNotifications(tablesDB, tx, this.context.householdNotifications({ eventKey: String(input.idempotency.commandId), actorId: String(actorId), householdId: String(expense.householdId), type: "expense-created", title: "New expense", body: `${expenseName} added ${expense.name} — ${formatNotificationBdt(expense.amount)}`, createdAt: expense.createdAt, entityType: "expense", entityId: String(expense.expenseId), memberships }));
        await this.context.stageOutcome(tablesDB, tx, input.idempotency, String(expense.expenseId), expense.createdAt);
        this.context.lastR3StagedOperations.createExpense = tx.stagedOperations();
        return String(expense.expenseId);
      }),
      (resourceId) => resourceId,
      input.idempotency,
    );
  }

async editExpense(input: Parameters<AtomicApplicationPersistence["editExpense"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    const actorId = input.actorId ?? input.auditEvents[0]?.actorId;
    if (!actorId) throw new ApplicationError("CONFLICT", "Expense command actor is missing.");
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(actorId), intentSeed: {} },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
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
        await this.context.getAliveHousehold(tables, String(current.householdId));
        const memberships = await this.context.householdMemberships(tables, String(current.householdId));
        const permissions = getExpensePermissions(current.householdId, actorId, current.creatorId, memberships);
        assertCanEditExpense(permissions);
        this.context.assertExpenseParticipants(proposed, memberships, false);

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
        const dateChanged = proposed.expenseDate !== current.expenseDate;
        if (dateChanged) assertExpenseDateWithinEntryWindow(proposed.expenseDate, proposed.updatedAt);
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
            this.context.requireBackdatedConfirmation({
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
          data: this.context.expenseRowData(proposed),
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        if (newSnapshot) await this.context.stagePrivateCardSnapshot(tablesDB, tx, newSnapshot, proposed.updatedAt, true);
        await this.context.stageAudit(tablesDB, tx, input.auditEvents[0]!);
        const editorName = await this.context.notificationName(tables, String(actorId));
        if (financialChanged) await this.context.stageNotifications(tablesDB, tx, this.context.householdNotifications({ eventKey: String(input.commandId ?? input.auditEvents[0]!.auditEventId), actorId: String(actorId), householdId: String(current.householdId), type: proposed.deletedAt ? "expense-deleted" : "expense-materially-updated", title: proposed.deletedAt ? "Expense deleted" : "Expense updated", body: proposed.deletedAt ? `${editorName} deleted ${proposed.name}` : `${editorName} updated ${proposed.name}`, createdAt: proposed.updatedAt, entityType: "expense", entityId: String(proposed.expenseId), memberships }));
        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(actorId), {}, String(current.expenseId), proposed.updatedAt);
        this.context.lastR3StagedOperations[proposed.deletedAt ? "deleteExpense" : "editExpense"] = tx.stagedOperations();
      }),
      () => undefined,
    );
  }

async createExpenseComment(input: Parameters<AtomicApplicationPersistence["createExpenseComment"]>[0]): Promise<string> {
    const tablesDB = this.context.tablesDB;
    const { comment, idempotency } = input;
    const actorId = idempotency.actorId;
    assertExpenseComment(comment);
    if (actorId !== comment.authorUserId || idempotency.commandType !== "create-expense-comment") {
      throw new ApplicationError("INVALID_INPUT", "Comment command identity is invalid.");
    }
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(comment.authorUserId), intentSeed: { expenseId: String(comment.expenseId), body: comment.body } },
      () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
        const expenseRaw = await tables.getRow(TABLE.expenses, String(comment.expenseId));
        const expense = expenseRaw ? mapExpense(expenseRaw) : undefined;
        const householdRaw = expense ? await tables.getRow(TABLE.households, String(expense.householdId)) : undefined;
        const household = householdRaw ? mapHousehold(householdRaw) : undefined;
        if (!expense || expense.deletedAt || !household || household.deletedAt || expense.householdId !== comment.householdId) {
          throw new ApplicationError("NOT_FOUND", "Expense not found.");
        }
        const membership = await this.context.householdMemberships(tables, String(expense.householdId));
        if (!membership.some((item) => item.userId === actorId && item.status === "active")) {
          throw new ApplicationError("NOT_FOUND", "Expense not found.");
        }
        if (await tables.getRow(TABLE.expenseComments, String(comment.commentId))) {
          throw new ApplicationError("CONFLICT", "Comment already exists.");
        }
        await tablesDB.createRow({
          databaseId: "hft",
          tableId: TABLE.expenseComments,
          rowId: String(comment.commentId),
          data: { householdId: String(comment.householdId), expenseId: String(comment.expenseId), authorUserId: String(comment.authorUserId), body: comment.body, createdAt: comment.createdAt },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        const commenter = await this.context.notificationName(tables, String(actorId));
        const commentRecipients = expenseCommentRecipients({ creatorId: expense.creatorId, commenterId: actorId, memberships: membership });
        await this.context.stageNotifications(tablesDB, tx, commentRecipients.map((recipientUserId) => notificationDraft({ eventKey: String(idempotency.commandId), recipientUserId, type: "expense-comment-added", title: "New comment", body: `${commenter} commented on ${expense.name}`, createdAt: comment.createdAt, householdId: expense.householdId, entityType: "expense", entityId: String(expense.expenseId) })));
        await this.context.stageOutcome(tablesDB, tx, idempotency, String(comment.commentId), comment.createdAt);
        this.context.lastR3StagedOperations.createExpenseComment = tx.stagedOperations();
        return String(comment.commentId);
      }),
      (resourceId) => resourceId,
      idempotency,
    );
  }
}
