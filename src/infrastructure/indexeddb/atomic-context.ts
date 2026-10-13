import { ApplicationError } from "@/application/errors/application-error";
import { DEFAULT_RECEIPT_STORAGE_POLICY, type ReceiptStoragePolicy } from "@/application/receipts/receipt-storage-policy";
import { notificationDraft, uniqueActiveRecipients } from "@/application/notifications/notification-policy";
import type { Notification } from "@/domain/notifications/notification-types";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { type ExpenseFinancialFingerprint } from "@/domain/expenses/expense-financial-fingerprint";
import { type AuditEvent, type Card, type Expense, type ExpenseCardPrivateSnapshot } from "@/domain/records/domain-records";
import type { IDBPDatabase, IDBPTransaction, StoreNames } from "idb";
import { fromProfileRecord, toNotificationRecord } from "./mappers";
import type { HouseFinanceDatabase } from "./records";
import type { DatabaseSource } from "./database";

export function abortSafely<Stores extends StoreNames<HouseFinanceDatabase>[]>(
  transaction: IDBPTransaction<HouseFinanceDatabase, Stores, "readwrite">,
): void {
  void transaction.done.catch(() => undefined);
  try {
    transaction.abort();
  } catch {
    // The transaction may already have failed and aborted itself.
  }
}

export function expenseFingerprint(
  expense: Expense,
  cardAssociationIdentity?: string,
): ExpenseFinancialFingerprint {
  return {
    householdId: expense.householdId,
    amount: expense.amount,
    payerId: expense.payerId,
    splitMethod: expense.splitMethod,
    percentageEntries: expense.percentageEntries,
    allocations: expense.allocations,
    expenseDate: expense.expenseDate,
    payment: expense.payment,
    ...(expense.payment.method === "card"
      ? { cardAssociationIdentity }
      : {}),
    deleted: Boolean(expense.deletedAt),
  };
}

export function cardSnapshot(expense: Expense, card: Card): ExpenseCardPrivateSnapshot {
  return {
    expenseId: expense.expenseId,
    ownerId: expense.creatorId,
    cardId: card.cardId,
    cardName: card.name,
    cardType: card.type,
    colorId: card.colorId,
  };
}

export function householdStateChanged(message: string): ApplicationError {
  return new ApplicationError("HOUSEHOLD_STATE_CHANGED", message);
}

export function assertAuditMatches(
  audit: AuditEvent,
  householdId: string,
  actorId: string,
): void {
  if (audit.householdId !== householdId || audit.actorId !== actorId) {
    throw new ApplicationError(
      "CONFLICT",
      "The household audit does not match the requested action.",
    );
  }
}

export type NotificationTransaction = IDBPTransaction<HouseFinanceDatabase, StoreNames<HouseFinanceDatabase>[], "readwrite">;

export async function notificationActorName(tx: NotificationTransaction, actorId: string): Promise<string> {
  const raw = await tx.objectStore("userProfiles").get(actorId);
  return raw ? fromProfileRecord(raw, actorId).displayName : "A household member";
}

export async function stageNotifications(tx: NotificationTransaction, rows: readonly Notification[]): Promise<void> {
  for (const row of rows) await tx.objectStore("notifications").put(toNotificationRecord(row));
}

export function householdNotifications(input: Readonly<{
  eventKey: string;
  actorId?: string;
  householdId: string;
  type: Parameters<typeof notificationDraft>[0]["type"];
  title: string;
  body: string;
  createdAt: Parameters<typeof notificationDraft>[0]["createdAt"];
  entityType?: Parameters<typeof notificationDraft>[0]["entityType"];
  entityId?: string;
  memberships: readonly MembershipSnapshot[];
}>): readonly Notification[] {
  return uniqueActiveRecipients(input.memberships, input.actorId as never).map((recipientUserId) => notificationDraft({
    eventKey: input.eventKey,
    recipientUserId: recipientUserId as never,
    type: input.type,
    title: input.title,
    body: input.body,
    createdAt: input.createdAt,
    householdId: input.householdId as never,
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
  }));
}

export function accountNotification(input: Readonly<{
  eventKey: string;
  recipientUserId: string;
  type: Parameters<typeof notificationDraft>[0]["type"];
  title: string;
  body: string;
  createdAt: Parameters<typeof notificationDraft>[0]["createdAt"];
}>): Notification {
  return notificationDraft({ ...input, recipientUserId: input.recipientUserId as never, accountScoped: true });
}

/** Internal per-adapter state; never exposed through the public persistence facade. */
export class IndexedDbCommandContext {
constructor(
    private readonly source: DatabaseSource,
    readonly receiptStoragePolicy: ReceiptStoragePolicy = DEFAULT_RECEIPT_STORAGE_POLICY,
  ) {}

async db(): Promise<IDBPDatabase<HouseFinanceDatabase>> { return this.source; }
}
