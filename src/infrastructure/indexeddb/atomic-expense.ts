import { ApplicationError } from "@/application/errors/application-error";
import { BackdatedExpenseConfirmationRequiredError } from "@/application/errors/application-error";
import { expenseRelevantIntentDigest, localBackdatedConfirmationToken } from "@/application/expenses/backdated-expense-confirmation";
import { assertIdempotentIntent, commandOutcomeKey } from "@/application/idempotency/command-idempotency";
import { assertReceiptAdmission } from "@/application/receipts/receipt-storage-policy";
import { expenseCommentRecipients, notificationDraft, formatNotificationBdt } from "@/application/notifications/notification-policy";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { assertHouseholdFinancialState } from "@/domain/balances/household-financial-state";
import { assertExpenseDateWithinEntryWindow } from "@/domain/dates/business-calendar";
import { isBackdatedAfterSettlement, latestConfirmedSettlementBefore } from "@/domain/expenses/backdated-expense-policy";
import { assertConfirmedSettlementFinancialChangeAllowed, latestConfirmedSettlementAt } from "@/domain/expenses/confirmed-settlement-financial-lock";
import { assertFormerMemberChangeAllowed, assertLegacyPercentageChangeAllowed, expenseFinancialFingerprintsEqual } from "@/domain/expenses/expense-financial-fingerprint";
import { commandId } from "@/domain/shared/identifiers";
import { persistenceFailure, receiptBlob } from "./repositories";
import { fromCardRecord, fromCommandOutcomeRecord, fromExpenseRecord, fromHouseholdRecord, fromMembershipRecord, fromPrivateCardRecord, fromReceiptRecord, fromSettlementRecord, toAuditRecord, toCommandOutcomeRecord, toExpenseRecord, toExpenseCommentRecord, toPrivateCardRecord, toReceiptRecord } from "./mappers";
import { membershipKey } from "./keys";
import { IndexedDbCommandContext, abortSafely, expenseFingerprint, cardSnapshot, notificationActorName, stageNotifications, householdNotifications } from "./atomic-context";

/** expense commands retain their original complete transaction boundaries. */
export class IndexedDbExpenseCommands implements Pick<AtomicApplicationPersistence, "createExpense" | "createExpenseComment" | "editExpense"> {
  constructor(private readonly context: IndexedDbCommandContext) {}

async createExpense(input: Parameters<AtomicApplicationPersistence["createExpense"]>[0]): Promise<string> {
    const expense = toExpenseRecord(input.expense);
    const actorId = input.actorId ?? input.expense.creatorId;
    const activeCommandId = input.commandId ?? commandId(`local-create:${input.expense.expenseId}`);
    assertExpenseDateWithinEntryWindow(input.expense.expenseDate, input.expense.createdAt);
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
    const tx = (await this.context.db()).transaction(["memberships", "cards", "expenses", "settlements", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "userProfiles", "notifications", "auditEvents", "commandOutcomes"], "readwrite");
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
        }, receipt.metadata.sizeBytes, this.context.receiptStoragePolicy);
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
      const memberships = membershipRows.map((row) => fromMembershipRecord(row, row.key));
      const name = await notificationActorName(tx, actorId);
      const expenseRowsToStage = householdNotifications({ eventKey: activeCommandId, actorId, householdId: input.expense.householdId, type: "expense-created", title: "New expense", body: `${name} added ${input.expense.name} — ${formatNotificationBdt(input.expense.amount)}`, createdAt: input.expense.createdAt, entityType: "expense", entityId: input.expense.expenseId, memberships });
      const receiptRowsToStage = receipts.flatMap((receipt) => householdNotifications({ eventKey: `${activeCommandId}:${receipt.metadata.id}`, actorId, householdId: input.expense.householdId, type: "receipt-added", title: "Receipt added", body: `${name} added a receipt to ${input.expense.name}`, createdAt: input.expense.createdAt, entityType: "expense", entityId: input.expense.expenseId, memberships }));
      await stageNotifications(tx, [...expenseRowsToStage, ...receiptRowsToStage]);
      await tx.done;
      return input.expense.expenseId;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async createExpenseComment(input: Parameters<AtomicApplicationPersistence["createExpenseComment"]>[0]): Promise<string> {
    const commentRecord = toExpenseCommentRecord(input.comment);
    const actorId = input.idempotency.actorId;
    if (actorId !== input.comment.authorUserId || input.idempotency.commandType !== "create-expense-comment") {
      throw new ApplicationError("CONFLICT", "Comment command identity is inconsistent.");
    }
    const tx = (await this.context.db()).transaction(["households", "memberships", "expenses", "expenseComments", "userProfiles", "notifications", "commandOutcomes"], "readwrite");
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) {
        const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey);
        assertIdempotentIntent(existing, input.idempotency);
        await tx.done;
        return existing.resourceId;
      }
      const expenseRaw = await tx.objectStore("expenses").get(input.comment.expenseId);
      if (!expenseRaw) throw new ApplicationError("NOT_FOUND", "Expense not found.");
      const expense = fromExpenseRecord(expenseRaw, input.comment.expenseId);
      const householdRaw = await tx.objectStore("households").get(expense.householdId);
      const membershipKeyValue = membershipKey(expense.householdId, actorId);
      const [membershipRaw, membershipRows] = await Promise.all([
        tx.objectStore("memberships").get(membershipKeyValue),
        tx.objectStore("memberships").index("householdId").getAll(expense.householdId),
      ]);
      if (!householdRaw || !membershipRaw) throw new ApplicationError("NOT_FOUND", "Expense not found.");
      const household = fromHouseholdRecord(householdRaw, expense.householdId);
      const membership = fromMembershipRecord(membershipRaw, membershipKeyValue);
      if (expense.deletedAt || household.deletedAt || membership.status !== "active" || expense.householdId !== input.comment.householdId) {
        throw new ApplicationError("NOT_FOUND", "Expense not found.");
      }
      await tx.objectStore("expenseComments").add(commentRecord);
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.comment.commentId, completedAt: input.comment.createdAt }));
      const name = await notificationActorName(tx, input.comment.authorUserId);
      const memberships = membershipRows.map((row) => fromMembershipRecord(row, row.key));
      await stageNotifications(tx, expenseCommentRecipients({ creatorId: expense.creatorId, commenterId: input.comment.authorUserId, memberships }).map((recipientUserId) => notificationDraft({ eventKey: input.idempotency.commandId, recipientUserId, type: "expense-comment-added", title: "New comment", body: `${name} commented on ${expense.name}`, createdAt: input.comment.createdAt, householdId: expense.householdId, entityType: "expense", entityId: expense.expenseId })));
      await tx.done;
      return input.comment.commentId;
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
    const tx = (await this.context.db()).transaction(["memberships", "cards", "expenses", "settlements", "expenseCardPrivateDetails", "receiptMetadata", "receiptBlobs", "userProfiles", "notifications", "auditEvents"], "readwrite");
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
        }, addition.metadata.sizeBytes, this.context.receiptStoragePolicy);
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
      if (input.expense.expenseDate !== current.expenseDate) {
        assertExpenseDateWithinEntryWindow(input.expense.expenseDate, input.expense.updatedAt);
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
      const name = await notificationActorName(tx, commandActorId);
      const eventKey = input.commandId ?? commandId(`local-edit:${input.expectedExpenseId}:${input.expectedRevision}`);
      const notificationRows = [
        ...(expenseFinancialFingerprintsEqual(currentFingerprint, proposedFingerprint) ? [] : householdNotifications({ eventKey, actorId: commandActorId, householdId: current.householdId, type: input.expense.deletedAt ? "expense-deleted" : "expense-materially-updated", title: input.expense.deletedAt ? "Expense deleted" : "Expense updated", body: input.expense.deletedAt ? `${name} deleted ${input.expense.name}` : `${name} updated ${input.expense.name}`, createdAt: input.expense.updatedAt, entityType: "expense", entityId: input.expense.expenseId, memberships: currentMemberships })),
        ...additions.flatMap((addition) => householdNotifications({ eventKey: `${eventKey}:${addition.metadata.id}`, actorId: commandActorId, householdId: current.householdId, type: "receipt-added", title: "Receipt added", body: `${name} added a receipt to ${input.expense.name}`, createdAt: input.expense.updatedAt, entityType: "expense", entityId: input.expense.expenseId, memberships: currentMemberships })),
        ...removals.flatMap((removal) => householdNotifications({ eventKey: `${eventKey}:${removal.id}`, actorId: commandActorId, householdId: current.householdId, type: "receipt-removed", title: "Receipt removed", body: `${name} removed a receipt from ${input.expense.name}`, createdAt: input.expense.updatedAt, entityType: "expense", entityId: input.expense.expenseId, memberships: currentMemberships })),
      ];
      await stageNotifications(tx, notificationRows);
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }
}
