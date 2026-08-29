import "server-only";

import { Query, type TablesDB } from "node-appwrite";
import { ApplicationError } from "@/application/errors/application-error";
import { canonicalIntentDigest } from "@/application/idempotency/command-idempotency";
import { assertReceiptAdmission } from "@/application/receipts/receipt-storage-policy";
import type { PrivateReceiptView } from "@/application/services/application-services";
import type { ReceiptContent } from "@/application/repositories";
import { MAX_RECEIPT_BYTES } from "@/domain/records/domain-records";
import type { UserId } from "@/domain/shared/identifiers";
import {
  commandOutcomeRowId,
  guardRowId,
  receiptAuditRowId,
  receiptMetadataRowId,
  receiptReservationRowId,
  receiptStorageFileId,
} from "../ids";
import { mapExpense, mapMembership, mapReceiptMetadata } from "../reads/mappers.server";
import { createTablesReader, type AppwriteRow, type TablesReader } from "../reads/tables.server";
import type { ReceiptStoragePort } from "./receipt-storage.server";
import { sha256Bytes } from "./receipt-storage.server";
import { decodeReceiptContentOnServer } from "./receipt-content-decoder.server";
import { runCommandTransaction, type CommandTransaction } from "./tx-runner.server";
import { CommandGuardEngine } from "./guards.server";

const TABLE = {
  expenses: "expenses",
  memberships: "memberships",
  receipts: "receipt_metadata",
  reservations: "receipt_reservations",
  outcomes: "command_outcomes",
  guards: "coordination_guards",
  audits: "audit_events",
} as const;

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReceiptMimeType = (typeof ALLOWED_MIME)[number];
export const RECEIPT_RESERVATION_TTL_MS = 60 * 60 * 1000;

export interface ReceiptUploadInput {
  readonly expenseId: string;
  readonly commandId: string;
  readonly mimeType: ReceiptMimeType;
  readonly originalFilename?: string;
  readonly bytes: Uint8Array;
}

export interface ReceiptRemovalInput {
  readonly receiptId: string;
  readonly commandId: string;
}

export interface ReceiptBinaryResult {
  readonly bytes: Uint8Array;
  readonly mimeType: ReceiptMimeType;
  readonly sizeBytes: number;
}

interface AuthorizedReceipt {
  readonly raw: AppwriteRow;
  readonly expense: ReturnType<typeof mapExpense>;
}

function isAllowedMime(value: string): value is ReceiptMimeType {
  return (ALLOWED_MIME as readonly string[]).includes(value);
}

function commandLogicalKey(actorId: string, commandType: "upload-receipt" | "remove-receipt", commandId: string): string {
  return `receipt-command:${commandOutcomeRowId({ actorId, commandType, commandId })}`;
}

function digestOwnerValue(intentDigest: string): string {
  const value = intentDigest.startsWith("sha256:") ? intentDigest.slice(7) : intentDigest;
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new ApplicationError("INVALID_INPUT", "Receipt command intent is invalid.");
  return value;
}

function privateProjection(row: AppwriteRow, canRemove: boolean): PrivateReceiptView {
  const metadata = mapReceiptMetadata(row);
  return Object.freeze({
    visibility: "private",
    receiptId: metadata.receiptId,
    ...(metadata.originalFilename ? { originalFilename: metadata.originalFilename } : {}),
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    createdAt: metadata.createdAt,
    contentStatus: metadata.contentStatus,
    canRead: metadata.contentStatus === "available",
    canRemove: canRemove && metadata.contentStatus === "available",
  });
}

function safeFilename(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new ApplicationError("INVALID_INPUT", "Receipt filename is invalid.");
  }
  return trimmed;
}

function genericStorageFilename(mimeType: ReceiptMimeType): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length);
  return `receipt.${extension}`;
}

export class ReceiptOperations {
  readonly lastStagedOperations: Partial<Record<"reserve" | "finalize" | "remove" | "release", number>> = {};

  constructor(
    private readonly tablesDB: TablesDB,
    private readonly storage: ReceiptStoragePort,
    private readonly actorId: UserId,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private tables(tx?: CommandTransaction): TablesReader {
    return createTablesReader(this.tablesDB, tx ? { transactionId: tx.id } : undefined);
  }

  private async requireActiveMembership(tables: TablesReader, householdId: string): Promise<void> {
    const rows = await tables.listRows(TABLE.memberships, [
      Query.equal("householdId", householdId),
      Query.equal("userId", String(this.actorId)),
      Query.equal("status", "active"),
    ]);
    if (!rows[0] || mapMembership(rows[0]).status !== "active") throw new ApplicationError("NOT_FOUND", "Receipt not found.");
  }

  private async authorizeExpenseCreator(tables: TablesReader, expenseId: string, requireAlive: boolean): Promise<ReturnType<typeof mapExpense>> {
    const raw = await tables.getRow(TABLE.expenses, expenseId);
    const expense = raw ? mapExpense(raw) : undefined;
    if (!expense || (requireAlive && expense.deletedAt) || String(expense.creatorId) !== String(this.actorId)) {
      throw new ApplicationError("NOT_FOUND", "Expense not found.");
    }
    await this.requireActiveMembership(tables, String(expense.householdId));
    return expense;
  }

  private async authorizeReceipt(tables: TablesReader, receiptId: string, creatorOnly: boolean): Promise<AuthorizedReceipt> {
    const raw = await tables.getRow(TABLE.receipts, receiptId);
    if (!raw) throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    const metadata = mapReceiptMetadata(raw);
    const expenseRaw = await tables.getRow(TABLE.expenses, String(metadata.expenseId));
    const expense = expenseRaw ? mapExpense(expenseRaw) : undefined;
    const actor = String(this.actorId);
    if (!expense || (creatorOnly ? String(expense.creatorId) !== actor : String(expense.creatorId) !== actor && String(metadata.createdByUserId) !== actor)) {
      throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    }
    await this.requireActiveMembership(tables, String(metadata.householdId));
    return { raw, expense };
  }

  private async committedOutcome(commandType: "upload-receipt" | "remove-receipt", commandId: string, intentDigest: string): Promise<string | undefined> {
    const row = await this.tables().getRow(TABLE.outcomes, commandOutcomeRowId({ actorId: String(this.actorId), commandType, commandId }));
    if (!row) return undefined;
    if (String(row.intentDigest) !== intentDigest) throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for different content.");
    return String(row.resourceId);
  }

  private async stageOutcome(tx: CommandTransaction, commandType: "upload-receipt" | "remove-receipt", commandId: string, intentDigest: string, resourceId: string, completedAt: string): Promise<void> {
    await this.tablesDB.createRow({
      databaseId: "hft", tableId: TABLE.outcomes,
      rowId: commandOutcomeRowId({ actorId: String(this.actorId), commandType, commandId }),
      data: { actorId: this.actorId, commandType, commandId, intentDigest, resourceId, completedAt }, transactionId: tx.id,
    });
    tx.recordStagedOperation();
  }

  private async stageAudit(tx: CommandTransaction, commandType: "upload-receipt" | "remove-receipt", commandId: string, householdId: string, receiptId: string, action: string, fields: readonly string[], occurredAt: string): Promise<void> {
    await this.tablesDB.createRow({
      databaseId: "hft", tableId: TABLE.audits,
      rowId: receiptAuditRowId(String(this.actorId), commandType, commandId),
      data: { householdId, aggregateType: "receipt", aggregateId: receiptId, actorId: this.actorId, action, changedFieldsJson: JSON.stringify(fields), occurredAt },
      transactionId: tx.id,
    });
    tx.recordStagedOperation();
  }

  private async authoritativeUsage(tables: TablesReader, expenseId: string, uploaderId = String(this.actorId)): Promise<{ expenseCount: number; uploaderBytes: number; projectBytes: number }> {
    const [available, reserved] = await Promise.all([
      tables.listRows(TABLE.receipts, [Query.equal("contentState", "available")]),
      tables.listRows(TABLE.reservations, [Query.equal("state", "reserved")]),
    ]);
    return {
      expenseCount: available.filter((row) => row.expenseId === expenseId).length + reserved.filter((row) => row.expenseId === expenseId).length,
      uploaderBytes: available.filter((row) => row.uploaderId === uploaderId).reduce((sum, row) => sum + Number(row.sizeBytes), 0)
        + reserved.filter((row) => row.uploaderId === uploaderId).reduce((sum, row) => sum + Number(row.bytes), 0),
      projectBytes: available.reduce((sum, row) => sum + Number(row.sizeBytes), 0) + reserved.reduce((sum, row) => sum + Number(row.bytes), 0),
    };
  }

  private async stageCounter(tx: CommandTransaction, tables: TablesReader, logicalKey: string, counter: number, occurredAt: string): Promise<void> {
    if (!Number.isSafeInteger(counter) || counter < 0) throw new ApplicationError("PERSISTENCE_FAILURE", "Receipt quota state is invalid.");
    const rowId = guardRowId(logicalKey);
    const existing = await tables.getRow(TABLE.guards, rowId);
    if (existing && String(existing.logicalKey) !== logicalKey) throw new ApplicationError("PERSISTENCE_FAILURE", "Receipt quota guard is invalid.");
    if (existing) {
      await this.tablesDB.updateRow({ databaseId: "hft", tableId: TABLE.guards, rowId, data: { counter, version: Number(existing.version) + 1 }, transactionId: tx.id });
    } else {
      await this.tablesDB.createRow({ databaseId: "hft", tableId: TABLE.guards, rowId, data: { logicalKey, ownerValue: null, counter, version: 1, createdAt: occurredAt }, transactionId: tx.id });
    }
    tx.recordStagedOperation();
  }

  private async stageUsageCounters(tx: CommandTransaction, tables: TablesReader, expenseId: string, usage: { expenseCount: number; uploaderBytes: number; projectBytes: number }, occurredAt: string, uploaderId = String(this.actorId)): Promise<void> {
    await this.stageCounter(tx, tables, `receipt-count:${expenseId}`, usage.expenseCount, occurredAt);
    await this.stageCounter(tx, tables, `receipt-uploader-bytes:${uploaderId}`, usage.uploaderBytes, occurredAt);
    await this.stageCounter(tx, tables, "receipt-project-bytes", usage.projectBytes, occurredAt);
  }

  private async releaseReservation(commandId: string, expectedBytes: number): Promise<void> {
    await runCommandTransaction(this.tablesDB, async ({ tx }) => {
      const tables = this.tables(tx);
      const reservationId = receiptReservationRowId(String(this.actorId), commandId);
      const reservation = await tables.getRow(TABLE.reservations, reservationId);
      if (!reservation || reservation.state !== "reserved") return;
      const usage = await this.authoritativeUsage(tables, String(reservation.expenseId));
      await this.tablesDB.updateRow({ databaseId: "hft", tableId: TABLE.reservations, rowId: reservationId, data: { state: "released" }, transactionId: tx.id });
      tx.recordStagedOperation();
      await this.stageUsageCounters(tx, tables, String(reservation.expenseId), {
        expenseCount: usage.expenseCount - 1,
        uploaderBytes: usage.uploaderBytes - expectedBytes,
        projectBytes: usage.projectBytes - expectedBytes,
      }, this.now());
      this.lastStagedOperations.release = tx.stagedOperations();
    });
  }

  async upload(input: ReceiptUploadInput): Promise<PrivateReceiptView> {
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_RECEIPT_BYTES || !isAllowedMime(input.mimeType)) {
      throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt content is not a valid supported image.");
    }
    const filename = safeFilename(input.originalFilename);
    const checksum = sha256Bytes(input.bytes);
    const intentDigest = canonicalIntentDigest({ expenseId: input.expenseId, filename, mimeType: input.mimeType, sizeBytes: input.bytes.byteLength, checksum });
    await this.authorizeExpenseCreator(this.tables(), input.expenseId, true);
    const replay = await this.committedOutcome("upload-receipt", input.commandId, intentDigest);
    if (replay) {
      const authorized = await this.authorizeReceipt(this.tables(), replay, true);
      return privateProjection(authorized.raw, true);
    }

    const reservationId = receiptReservationRowId(String(this.actorId), input.commandId);
    const receiptId = receiptMetadataRowId(String(this.actorId), input.commandId);
    const fileId = receiptStorageFileId(String(this.actorId), input.commandId);
    const ownerDigest = digestOwnerValue(intentDigest);
    const existingReservation = await this.tables().getRow(TABLE.reservations, reservationId);
    if (existingReservation) {
      const guard = await this.tables().getRow(TABLE.guards, guardRowId(commandLogicalKey(String(this.actorId), "upload-receipt", input.commandId)));
      if (!guard || String(guard.ownerValue) !== ownerDigest || Number(existingReservation.bytes) !== input.bytes.byteLength || String(existingReservation.expenseId) !== input.expenseId) {
        throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for different content.");
      }
      if (existingReservation.state === "reserved") {
        const existingFile = await this.storage.read(fileId);
        if (existingFile && (existingFile.byteLength !== input.bytes.byteLength || sha256Bytes(existingFile) !== checksum)) {
          throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for different content.");
        }
      } else if (existingReservation.state !== "released") {
        throw new ApplicationError("IDEMPOTENCY_IN_PROGRESS", "This Receipt upload is still in progress.");
      }
    }

    if (!existingReservation || existingReservation.state !== "reserved") {
      await runCommandTransaction(this.tablesDB, async ({ tx }) => {
        const tables = this.tables(tx);
        const expense = await this.authorizeExpenseCreator(tables, input.expenseId, true);
        await new CommandGuardEngine(this.tablesDB, tx, this.now()).touch("financial", String(expense.householdId));
        const logicalKey = commandLogicalKey(String(this.actorId), "upload-receipt", input.commandId);
        const commandGuard = await tables.getRow(TABLE.guards, guardRowId(logicalKey));
        if (commandGuard && String(commandGuard.ownerValue) !== ownerDigest) throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for different content.");
        if (!commandGuard) {
          await this.tablesDB.createRow({ databaseId: "hft", tableId: TABLE.guards, rowId: guardRowId(logicalKey), data: { logicalKey, ownerValue: ownerDigest, counter: 0, version: 0, createdAt: this.now() }, transactionId: tx.id });
          tx.recordStagedOperation();
        }
        const usage = await this.authoritativeUsage(tables, input.expenseId);
        const admission = assertReceiptAdmission({ expenseAvailableCount: usage.expenseCount, uploaderAvailableBytes: usage.uploaderBytes, projectAvailableBytes: usage.projectBytes }, input.bytes.byteLength);
        const now = this.now();
        const expiresAt = new Date(new Date(now).getTime() + RECEIPT_RESERVATION_TTL_MS).toISOString();
        if (existingReservation) {
          await this.tablesDB.updateRow({ databaseId: "hft", tableId: TABLE.reservations, rowId: reservationId, data: { state: "reserved", expiresAt }, transactionId: tx.id });
        } else {
          await this.tablesDB.createRow({ databaseId: "hft", tableId: TABLE.reservations, rowId: reservationId, data: { uploaderId: this.actorId, expenseId: input.expenseId, bytes: input.bytes.byteLength, state: "reserved", expiresAt, createdAt: now }, transactionId: tx.id });
        }
        tx.recordStagedOperation();
        await this.stageUsageCounters(tx, tables, input.expenseId, { expenseCount: usage.expenseCount + 1, uploaderBytes: usage.uploaderBytes + input.bytes.byteLength, projectBytes: usage.projectBytes + input.bytes.byteLength }, now);
        this.lastStagedOperations.reserve = tx.stagedOperations();
        void admission.projectWarningThresholdReached;
      });
    }

    const content: ReceiptContent = { mimeType: input.mimeType, bytes: input.bytes };
    try {
      await decodeReceiptContentOnServer(content);
    } catch (error) {
      await this.releaseReservation(input.commandId, input.bytes.byteLength).catch(() => undefined);
      throw error;
    }

    const stored = await this.storage.read(fileId);
    if (stored) {
      if (stored.byteLength !== input.bytes.byteLength || sha256Bytes(stored) !== checksum) {
        throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for different content.");
      }
    } else {
      try {
        await this.storage.create(fileId, input.bytes, genericStorageFilename(input.mimeType));
      } catch (error) {
        const recovered = await this.storage.read(fileId).catch(() => undefined);
        if (!recovered || recovered.byteLength !== input.bytes.byteLength || sha256Bytes(recovered) !== checksum) {
          await this.releaseReservation(input.commandId, input.bytes.byteLength).catch(() => undefined);
          throw error;
        }
      }
    }

    try {
      await runCommandTransaction(this.tablesDB, async ({ tx }) => {
        const tables = this.tables(tx);
        const expense = await this.authorizeExpenseCreator(tables, input.expenseId, true);
        await new CommandGuardEngine(this.tablesDB, tx, this.now()).touch("financial", String(expense.householdId));
        const reservation = await tables.getRow(TABLE.reservations, reservationId);
        if (!reservation || reservation.state !== "reserved") throw new ApplicationError("IDEMPOTENCY_IN_PROGRESS", "This Receipt upload is not ready to finalize.");
        const now = this.now();
        await this.tablesDB.createRow({ databaseId: "hft", tableId: TABLE.receipts, rowId: receiptId, data: { storageFileId: fileId, uploaderId: this.actorId, householdId: expense.householdId, expenseId: input.expenseId, mimeType: input.mimeType, sizeBytes: input.bytes.byteLength, contentState: "available", contentRemovedAt: null, contentRemovedByUserId: null, originalFilename: filename ?? null, checksum, createdAt: now }, transactionId: tx.id });
        tx.recordStagedOperation();
        await this.stageAudit(tx, "upload-receipt", input.commandId, String(expense.householdId), receiptId, "created", ["mimeType", "sizeBytes", "contentState"], now);
        await this.stageOutcome(tx, "upload-receipt", input.commandId, intentDigest, receiptId, now);
        await this.tablesDB.updateRow({ databaseId: "hft", tableId: TABLE.reservations, rowId: reservationId, data: { state: "finalized" }, transactionId: tx.id });
        tx.recordStagedOperation();
        this.lastStagedOperations.finalize = tx.stagedOperations();
      });
    } catch (error) {
      const outcome = await this.committedOutcome("upload-receipt", input.commandId, intentDigest).catch(() => undefined);
      if (!outcome) throw error;
    }
    const authorized = await this.authorizeReceipt(this.tables(), receiptId, true);
    return privateProjection(authorized.raw, true);
  }

  async read(receiptId: string): Promise<ReceiptBinaryResult> {
    const authorized = await this.authorizeReceipt(this.tables(), receiptId, false);
    const metadata = mapReceiptMetadata(authorized.raw);
    if (metadata.contentStatus !== "available") throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    const fileId = String(authorized.raw.storageFileId);
    const expectedChecksum = String(authorized.raw.checksum);
    const bytes = await this.storage.read(fileId);
    if (!bytes || bytes.byteLength !== metadata.sizeBytes || sha256Bytes(bytes) !== expectedChecksum) throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    const current = await this.authorizeReceipt(this.tables(), receiptId, false);
    if (mapReceiptMetadata(current.raw).contentStatus !== "available") throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    return Object.freeze({ bytes, mimeType: metadata.mimeType, sizeBytes: bytes.byteLength });
  }

  async remove(input: ReceiptRemovalInput): Promise<{ readonly receiptId: string; readonly status: "user-deleted" }> {
    const intentDigest = canonicalIntentDigest({ receiptId: input.receiptId });
    const authorized = await this.authorizeReceipt(this.tables(), input.receiptId, true);
    const replay = await this.committedOutcome("remove-receipt", input.commandId, intentDigest);
    if (replay) return Object.freeze({ receiptId: replay, status: "user-deleted" });
    const metadata = mapReceiptMetadata(authorized.raw);
    if (metadata.contentStatus !== "available") throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    const logicalKey = commandLogicalKey(String(this.actorId), "remove-receipt", input.commandId);
    const ownerDigest = digestOwnerValue(intentDigest);
    await runCommandTransaction(this.tablesDB, async ({ tx }) => {
      const tables = this.tables(tx);
      await this.authorizeReceipt(tables, input.receiptId, true);
      const commandGuard = await tables.getRow(TABLE.guards, guardRowId(logicalKey));
      if (commandGuard && String(commandGuard.ownerValue) !== ownerDigest) {
        throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for a different Receipt.");
      }
      if (!commandGuard) {
        await this.tablesDB.createRow({
          databaseId: "hft",
          tableId: TABLE.guards,
          rowId: guardRowId(logicalKey),
          data: { logicalKey, ownerValue: ownerDigest, counter: 0, version: 0, createdAt: this.now() },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
      }
    });
    await this.storage.remove(String(authorized.raw.storageFileId));
    try {
      await runCommandTransaction(this.tablesDB, async ({ tx }) => {
        const tables = this.tables(tx);
        const current = await this.authorizeReceipt(tables, input.receiptId, true);
        const currentMetadata = mapReceiptMetadata(current.raw);
        if (currentMetadata.contentStatus !== "available") throw new ApplicationError("NOT_FOUND", "Receipt not found.");
        const now = this.now();
        await new CommandGuardEngine(this.tablesDB, tx, now).touch("financial", String(current.expense.householdId));
        const uploaderId = String(currentMetadata.createdByUserId);
        const usage = await this.authoritativeUsage(tables, String(currentMetadata.expenseId), uploaderId);
        await this.tablesDB.updateRow({ databaseId: "hft", tableId: TABLE.receipts, rowId: input.receiptId, data: { contentState: "user-deleted", contentRemovedAt: now, contentRemovedByUserId: this.actorId }, transactionId: tx.id });
        tx.recordStagedOperation();
        await this.stageUsageCounters(tx, tables, String(currentMetadata.expenseId), { expenseCount: usage.expenseCount - 1, uploaderBytes: usage.uploaderBytes - currentMetadata.sizeBytes, projectBytes: usage.projectBytes - currentMetadata.sizeBytes }, now, uploaderId);
        await this.stageAudit(tx, "remove-receipt", input.commandId, String(currentMetadata.householdId), input.receiptId, "deleted", ["contentStatus", "contentRemovedAt", "contentRemovedByUserId"], now);
        await this.stageOutcome(tx, "remove-receipt", input.commandId, intentDigest, input.receiptId, now);
        this.lastStagedOperations.remove = tx.stagedOperations();
      });
    } catch (error) {
      const outcome = await this.committedOutcome("remove-receipt", input.commandId, intentDigest).catch(() => undefined);
      if (!outcome) throw error;
    }
    return Object.freeze({ receiptId: input.receiptId, status: "user-deleted" });
  }
}
