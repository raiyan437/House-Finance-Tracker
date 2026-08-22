import { poisha, positivePoisha } from "@/domain/money/poisha";
import { expenseDate } from "@/domain/dates/expense-date";
import type { AuditEvent, Card, Expense, ExpenseCardPrivateSnapshot, Household, JoinRequest, ReceiptMetadata, UserProfile } from "@/domain/records/domain-records";
import { auditEventId, cardId, expenseId, householdId, joinRequestId, receiptId, settlementId, userId, type UserId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import type { IDBPDatabase } from "idb";
import { toAuditRecord, toCardRecord, toExpenseRecord, toHouseholdRecord, toJoinRequestRecord, toMembershipRecord, toPrivateCardRecord, toProfileRecord, toReceiptRecord, toSettlementRecord } from "./mappers";
import { receiptBlob } from "./repositories";
import type { HouseFinanceDatabase } from "./records";

export const SEED_REVISION = "phase-4-v1";
export const EMPTY_LOCAL_DATABASE_REVISION = "local-empty-v1";
export const SEEDED_USER_IDS = Object.freeze({
  raiyan: userId("user-raiyan"),
  john: userId("user-john"),
  sarah: userId("user-sarah"),
  alex: userId("user-alex"),
});
export const SEEDED_HOUSEHOLD_ID = householdId("household-main");

const createdAt = isoInstant("2026-08-13T00:00:00.000Z");

function profile(id: UserId, displayName: string): UserProfile {
  const displayEmail = `${displayName.toLowerCase()}@local.test`;
  return { userId: id, displayName, displayEmail, emailKey: displayEmail, createdAt, updatedAt: createdAt };
}

export function deterministicSeedData() {
  const profiles = [profile(SEEDED_USER_IDS.raiyan, "Raiyan"), profile(SEEDED_USER_IDS.john, "John"), profile(SEEDED_USER_IDS.sarah, "Sarah"), profile(SEEDED_USER_IDS.alex, "Alex")];
  const household: Household = { householdId: SEEDED_HOUSEHOLD_ID, name: "Raiyan House", code: "012345678", createdAt, updatedAt: createdAt };
  const memberships: readonly MembershipSnapshot[] = [
    { householdId: SEEDED_HOUSEHOLD_ID, userId: SEEDED_USER_IDS.raiyan, status: "active", role: "leader" },
    { householdId: SEEDED_HOUSEHOLD_ID, userId: SEEDED_USER_IDS.john, status: "active", role: "member" },
    { householdId: SEEDED_HOUSEHOLD_ID, userId: SEEDED_USER_IDS.sarah, status: "active", role: "member" },
  ];
  const joinRequest: JoinRequest = { joinRequestId: joinRequestId("join-alex-main"), householdId: SEEDED_HOUSEHOLD_ID, userId: SEEDED_USER_IDS.alex, status: "pending", createdAt };
  const cards: readonly Card[] = [
    { cardId: cardId("card-raiyan-debit"), ownerId: SEEDED_USER_IDS.raiyan, name: "Daily Debit", type: "debit", colorId: "mint", createdAt, updatedAt: createdAt },
    { cardId: cardId("card-john-credit"), ownerId: SEEDED_USER_IDS.john, name: "John Credit", type: "credit", colorId: "powder-blue", createdAt, updatedAt: createdAt },
  ];
  const expenseCash: Expense = { expenseId: expenseId("expense-groceries"), householdId: SEEDED_HOUSEHOLD_ID, creatorId: SEEDED_USER_IDS.raiyan, payerId: SEEDED_USER_IDS.raiyan, name: "Groceries", amount: positivePoisha(30000), expenseDate: expenseDate("2026-08-10"), splitMethod: "equal", allocations: [SEEDED_USER_IDS.john, SEEDED_USER_IDS.raiyan, SEEDED_USER_IDS.sarah].map((participantId) => ({ participantId, share: poisha(10000) })), payment: { method: "cash" }, revision: 1, createdAt, updatedAt: createdAt };
  const expenseCard: Expense = { expenseId: expenseId("expense-internet"), householdId: SEEDED_HOUSEHOLD_ID, creatorId: SEEDED_USER_IDS.john, payerId: SEEDED_USER_IDS.john, name: "Internet", amount: positivePoisha(15000), expenseDate: expenseDate("2026-08-11"), splitMethod: "equal", allocations: [SEEDED_USER_IDS.john, SEEDED_USER_IDS.sarah].map((participantId) => ({ participantId, share: poisha(7500) })), payment: { method: "card", cardReference: "private:expense-internet" }, revision: 1, createdAt, updatedAt: createdAt };
  const privateCard: ExpenseCardPrivateSnapshot = { expenseId: expenseCard.expenseId, ownerId: SEEDED_USER_IDS.john, cardId: cards[1].cardId, cardName: cards[1].name, cardType: cards[1].type, colorId: cards[1].colorId };
  const settlement: SettlementRecord = { settlementId: settlementId("settlement-john-raiyan"), householdId: SEEDED_HOUSEHOLD_ID, senderId: SEEDED_USER_IDS.john, receiverId: SEEDED_USER_IDS.raiyan, amount: positivePoisha(2500), originatingRecommendation: { householdId: SEEDED_HOUSEHOLD_ID, senderId: SEEDED_USER_IDS.john, receiverId: SEEDED_USER_IDS.raiyan, amount: positivePoisha(2500) }, createdAt, status: "pending" };
  const receiptBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b,
    0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0xf8, 0x0f, 0x00, 0x01,
    0x05, 0x01, 0x01, 0x27, 0x18, 0xe3, 0x66, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const receipt: ReceiptMetadata = { receiptId: receiptId("receipt-groceries"), householdId: SEEDED_HOUSEHOLD_ID, expenseId: expenseCash.expenseId, createdByUserId: SEEDED_USER_IDS.raiyan, mimeType: "image/png", originalFilename: "groceries.png", sizeBytes: receiptBytes.byteLength, createdAt, contentStatus: "available" };
  const audits: readonly AuditEvent[] = [
    { auditEventId: auditEventId("audit-seed-household"), householdId: SEEDED_HOUSEHOLD_ID, actorId: SEEDED_USER_IDS.raiyan, aggregateType: "household", aggregateId: SEEDED_HOUSEHOLD_ID, action: "created", occurredAt: createdAt, changedFields: ["name", "code"] },
    { auditEventId: auditEventId("audit-seed-expense-cash"), householdId: SEEDED_HOUSEHOLD_ID, actorId: SEEDED_USER_IDS.raiyan, aggregateType: "expense", aggregateId: expenseCash.expenseId, action: "created", occurredAt: createdAt, changedFields: ["name", "amount", "allocations", "payment"] },
    { auditEventId: auditEventId("audit-seed-expense-card"), householdId: SEEDED_HOUSEHOLD_ID, actorId: SEEDED_USER_IDS.john, aggregateType: "expense", aggregateId: expenseCard.expenseId, action: "created", occurredAt: createdAt, changedFields: ["name", "amount", "allocations", "payment"] },
  ];
  return Object.freeze({ profiles, household, memberships, joinRequest, cards, expenses: [expenseCash, expenseCard] as const, privateCard, settlement, receipt, receiptBytes, audits });
}

const LOCAL_DATABASE_STORES = [
  "appMeta",
  "userProfiles",
  "households",
  "memberships",
  "joinRequests",
  "expenses",
  "expenseCardPrivateDetails",
  "settlements",
  "cards",
  "receiptMetadata",
  "receiptBlobs",
  "auditEvents",
  "developmentSession",
] as const;

/**
 * Initializes the browser runtime without sample household or financial records.
 * The revision gate clears the previous accepted development seed exactly once;
 * subsequent app launches preserve records created by the local user.
 */
export async function initializeLocalDatabase(db: IDBPDatabase<HouseFinanceDatabase>): Promise<void> {
  const existing = await db.get("appMeta", "seedRevision");
  if (existing?.value === EMPTY_LOCAL_DATABASE_REVISION) return;

  const tx = db.transaction(LOCAL_DATABASE_STORES, "readwrite");
  for (const store of LOCAL_DATABASE_STORES) {
    await tx.objectStore(store).clear();
  }

  const profiles = [
    profile(SEEDED_USER_IDS.raiyan, "Raiyan"),
    profile(SEEDED_USER_IDS.john, "John"),
    profile(SEEDED_USER_IDS.sarah, "Sarah"),
    profile(SEEDED_USER_IDS.alex, "Alex"),
  ];
  for (const value of profiles) {
    await tx.objectStore("userProfiles").add(toProfileRecord(value));
  }
  await tx.objectStore("developmentSession").put({
    key: "current",
    currentUserId: SEEDED_USER_IDS.raiyan,
  });
  await tx.objectStore("appMeta").put({
    key: "seedRevision",
    value: EMPTY_LOCAL_DATABASE_REVISION,
  });
  await tx.done;
}

export async function seedLocalDatabase(db: IDBPDatabase<HouseFinanceDatabase>): Promise<void> {
  const existing = await db.get("appMeta", "seedRevision");
  if (existing?.value === SEED_REVISION) return;
  const seed = deterministicSeedData();
  const stores = ["appMeta", "userProfiles", "households", "memberships", "joinRequests", "expenses", "expenseCardPrivateDetails", "settlements", "cards", "receiptMetadata", "receiptBlobs", "auditEvents", "developmentSession"] as const;
  const tx = db.transaction(stores, "readwrite");
  for (const value of seed.profiles) await tx.objectStore("userProfiles").add(toProfileRecord(value));
  await tx.objectStore("households").add(toHouseholdRecord(seed.household));
  for (const value of seed.memberships) await tx.objectStore("memberships").add(toMembershipRecord(value));
  await tx.objectStore("joinRequests").add(toJoinRequestRecord(seed.joinRequest));
  for (const value of seed.cards) await tx.objectStore("cards").add(toCardRecord(value));
  for (const value of seed.expenses) await tx.objectStore("expenses").add(toExpenseRecord(value));
  await tx.objectStore("expenseCardPrivateDetails").add(toPrivateCardRecord(seed.privateCard));
  await tx.objectStore("settlements").add(toSettlementRecord(seed.settlement));
  await tx.objectStore("receiptMetadata").add(toReceiptRecord(seed.receipt));
  await tx.objectStore("receiptBlobs").add(receiptBlob(seed.receipt, { bytes: seed.receiptBytes, mimeType: seed.receipt.mimeType }));
  for (const value of seed.audits) await tx.objectStore("auditEvents").add(toAuditRecord(value));
  await tx.objectStore("developmentSession").put({ key: "current", currentUserId: SEEDED_USER_IDS.raiyan });
  await tx.objectStore("appMeta").put({ key: "seedRevision", value: SEED_REVISION });
  await tx.done;
}
