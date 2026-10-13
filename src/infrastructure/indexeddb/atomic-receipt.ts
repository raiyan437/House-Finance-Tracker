import { ApplicationError } from "@/application/errors/application-error";
import { assertIdempotentIntent, commandOutcomeKey } from "@/application/idempotency/command-idempotency";
import { assertReceiptAdmission } from "@/application/receipts/receipt-storage-policy";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { assertCanEditExpense, getExpensePermissions } from "@/domain/permissions/expense-permissions";

import { persistenceFailure, receiptBlob } from "./repositories";
import { fromCommandOutcomeRecord, fromExpenseRecord, fromHouseholdRecord, fromMembershipRecord, fromReceiptRecord, toAuditRecord, toCommandOutcomeRecord, toReceiptRecord } from "./mappers";
import { IndexedDbCommandContext, abortSafely, householdStateChanged, assertAuditMatches, notificationActorName, stageNotifications, householdNotifications } from "./atomic-context";

/** receipt commands retain their original complete transaction boundaries. */
export class IndexedDbReceiptCommands implements Pick<AtomicApplicationPersistence, "createReceipt" | "deleteReceipt"> {
  constructor(private readonly context: IndexedDbCommandContext) {}

async createReceipt(input: Parameters<AtomicApplicationPersistence["createReceipt"]>[0]): Promise<string> {
    if (input.metadata.contentStatus !== "available") throw new ApplicationError("CONFLICT", "New receipt content must be available.");
    if (input.idempotency.actorId !== input.metadata.createdByUserId || input.idempotency.commandType !== "upload-receipt") throw new ApplicationError("CONFLICT", "Receipt command identity is inconsistent.");
    const tx = (await this.context.db()).transaction(["households", "memberships", "expenses", "receiptMetadata", "receiptBlobs", "userProfiles", "notifications", "auditEvents", "commandOutcomes"], "readwrite");
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
      }, input.metadata.sizeBytes, this.context.receiptStoragePolicy);
      await tx.objectStore("receiptMetadata").add(toReceiptRecord(input.metadata));
      await tx.objectStore("receiptBlobs").add(receiptBlob(input.metadata, input.content));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.metadata.receiptId, completedAt: input.auditEvent.occurredAt }));
      const name = await notificationActorName(tx, input.metadata.createdByUserId);
      await stageNotifications(tx, householdNotifications({ eventKey: input.idempotency.commandId, actorId: input.metadata.createdByUserId, householdId: input.metadata.householdId, type: "receipt-added", title: "Receipt added", body: `${name} added a receipt to ${expense.name}`, createdAt: input.metadata.createdAt, entityType: "expense", entityId: input.metadata.expenseId, memberships }));
      await tx.done;
      return input.metadata.receiptId;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }

async deleteReceipt(input: Parameters<AtomicApplicationPersistence["deleteReceipt"]>[0]): Promise<void> {
    if (input.metadata.contentStatus !== "user-deleted" || !input.metadata.contentRemovedByUserId) throw new ApplicationError("CONFLICT", "Receipt deletion requires an explicit user-deleted state.");
    const tx = (await this.context.db()).transaction(["households", "memberships", "expenses", "receiptMetadata", "receiptBlobs", "userProfiles", "notifications", "auditEvents"], "readwrite");
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
      const name = await notificationActorName(tx, input.metadata.contentRemovedByUserId);
      await stageNotifications(tx, householdNotifications({ eventKey: input.auditEvent.auditEventId, actorId: input.metadata.contentRemovedByUserId, householdId: input.metadata.householdId, type: "receipt-removed", title: "Receipt removed", body: `${name} removed a receipt from ${expense.name}`, createdAt: input.metadata.contentRemovedAt ?? input.auditEvent.occurredAt, entityType: "expense", entityId: input.metadata.expenseId, memberships }));
      await tx.done;
    }
    catch (error) { abortSafely(tx); persistenceFailure(error); }
  }
}
