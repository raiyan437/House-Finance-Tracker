import { ApplicationError } from "../errors/application-error";
import { assertIdempotentIntent, binaryContentDigest, canonicalIntentDigest, type IdempotencyDescriptor } from "../idempotency/command-idempotency";
import { validateReceiptContent } from "../receipts/receipt-content-validation";
import type { ReceiptContent } from "../repositories";
import { markReceiptContentUserDeleted } from "@/domain/receipts/receipt-content-lifecycle";
import { assertCanEditExpense, getExpensePermissions } from "@/domain/permissions/expense-permissions";
import { assertReceiptMetadata, type ReceiptMetadata, type ReceiptContentStatus } from "@/domain/records/domain-records";
import { receiptId, type ExpenseId, type ReceiptId } from "@/domain/shared/identifiers";
import { commandId, type CommandId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import { type Dependencies, event, requireActiveMembership } from "./service-context";


export type ExpenseReceiptContent = ReceiptContent;

export interface ReceiptView {
  readonly visibility: "receipt";
  readonly receiptId: ReceiptId;
  readonly originalFilename?: string;
  readonly mimeType: ReceiptMetadata["mimeType"];
  readonly sizeBytes: number;
  readonly createdAt: IsoInstant;
  readonly contentStatus: ReceiptContentStatus;
  readonly canReadReceipt: boolean;
  readonly canRemoveReceipt: boolean;
}

function projectReceipt(metadata: ReceiptMetadata, canRemove: boolean): ReceiptView {
  const available = metadata.contentStatus === "available";
  return Object.freeze({
    visibility: "receipt",
    receiptId: metadata.receiptId,
    ...(metadata.originalFilename ? { originalFilename: metadata.originalFilename } : {}),
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    createdAt: metadata.createdAt,
    contentStatus: metadata.contentStatus,
    canReadReceipt: true,
    canRemoveReceipt: available && canRemove,
  });
}

export class ReceiptApplicationService {
  constructor(private readonly deps: Dependencies) {}
  async getMyAvailableReceiptBytes(): Promise<number> { const actor = await this.deps.session.getCurrentUserId(); return this.deps.repositories.receipts.availableBytesByUploader(actor); }
  async readReceipt(id: ReceiptId): Promise<ReceiptContent> { const actor = await this.deps.session.getCurrentUserId(); const metadata = await this.deps.repositories.receipts.getMetadata(id); if (!metadata || metadata.contentStatus !== "available") throw new ApplicationError("NOT_FOUND", "Receipt content is not available."); const expense = await this.deps.repositories.expenses.getById(metadata.expenseId); if (!expense || metadata.householdId !== expense.householdId) throw new ApplicationError("NOT_FOUND", "Receipt content is not available."); await requireActiveMembership(this.deps.repositories, expense.householdId, actor); const content = await this.deps.repositories.receipts.readContent(id); if (!content) throw new ApplicationError("NOT_FOUND", "Receipt content not found."); return content; }
  async listExpenseReceipts(expenseIdValue: ExpenseId): Promise<readonly ReceiptView[]> { const actor = await this.deps.session.getCurrentUserId(); const expense = await this.deps.repositories.expenses.getById(expenseIdValue); if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found."); await requireActiveMembership(this.deps.repositories, expense.householdId, actor); const metadata = await this.deps.repositories.receipts.listForExpense(expenseIdValue); if (metadata.some((item) => item.expenseId !== expense.expenseId || item.householdId !== expense.householdId)) throw new ApplicationError("NOT_FOUND", "Receipt not found."); return Object.freeze(metadata.map((item) => projectReceipt(item, actor === expense.creatorId))); }
  async addReceipt(expenseIdValue: ExpenseId, input: Readonly<{ originalFilename?: string; content: ReceiptContent; commandId?: CommandId }>): Promise<ReceiptMetadata> { const actor = await this.deps.session.getCurrentUserId(); const activeCommandId = input.commandId ?? commandId(this.deps.values.nextId("command")); const idempotency: IdempotencyDescriptor = { actorId: actor, commandType: "upload-receipt", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ expenseId: expenseIdValue, filename: input.originalFilename?.trim(), mimeType: input.content.mimeType, sizeBytes: input.content.bytes.byteLength, contentDigest: binaryContentDigest(input.content.bytes) }) }; const replay = await this.deps.repositories.commandOutcomes.get(idempotency); if (replay) { assertIdempotentIntent(replay, idempotency); const replayed = await this.deps.repositories.receipts.getMetadata(receiptId(replay.resourceId)); if (!replayed || replayed.createdByUserId !== actor || replayed.expenseId !== expenseIdValue) throw new ApplicationError("NOT_FOUND", "Receipt not found."); await requireActiveMembership(this.deps.repositories, replayed.householdId, actor); return replayed; } const expense = await this.deps.repositories.expenses.getById(expenseIdValue); if (!expense || expense.deletedAt || actor !== expense.creatorId) throw new ApplicationError("NOT_FOUND", "Expense not found."); const memberships = await this.deps.repositories.memberships.listByHousehold(expense.householdId); assertCanEditExpense(getExpensePermissions(expense.householdId, actor, expense.creatorId, memberships)); await validateReceiptContent(input.content, this.deps.receiptContentDecoder); const now = this.deps.values.now(); const metadata: ReceiptMetadata = { receiptId: receiptId(this.deps.values.nextId("receipt")), householdId: expense.householdId, expenseId: expense.expenseId, createdByUserId: actor, mimeType: input.content.mimeType, ...(input.originalFilename ? { originalFilename: input.originalFilename.trim() } : {}), sizeBytes: input.content.bytes.byteLength, createdAt: now, contentStatus: "available" }; assertReceiptMetadata(metadata); const resourceId = await this.deps.atomic.createReceipt({ metadata, content: input.content, idempotency, auditEvent: event(this.deps.values, expense.householdId, actor, "receipt", metadata.receiptId, "created", ["mimeType", "sizeBytes", "contentStatus"], now) }); const committed = await this.deps.repositories.receipts.getMetadata(receiptId(resourceId)); if (!committed || committed.createdByUserId !== actor || committed.expenseId !== expenseIdValue) throw new ApplicationError("NOT_FOUND", "Receipt not found."); return committed; }
  async deleteReceipt(id: ReceiptId): Promise<void> { const actor = await this.deps.session.getCurrentUserId(); const metadata = await this.deps.repositories.receipts.getMetadata(id); if (!metadata || metadata.contentStatus !== "available") throw new ApplicationError("NOT_FOUND", "Receipt content is not available."); const expense = await this.deps.repositories.expenses.getById(metadata.expenseId); if (!expense || metadata.householdId !== expense.householdId || actor !== expense.creatorId) throw new ApplicationError("NOT_FOUND", "Receipt content is not available."); const memberships = await this.deps.repositories.memberships.listByHousehold(expense.householdId); assertCanEditExpense(getExpensePermissions(expense.householdId, actor, expense.creatorId, memberships)); const now = this.deps.values.now(); const deleted = markReceiptContentUserDeleted(metadata, now, actor); await this.deps.atomic.deleteReceipt({ metadata: deleted, auditEvent: event(this.deps.values, expense.householdId, actor, "receipt", id, "deleted", ["contentStatus", "contentRemovedAt", "contentRemovedByUserId"], now) }); }
}
