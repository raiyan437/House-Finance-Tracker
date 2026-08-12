import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it } from "vitest";
import { openDB } from "idb";

import { ApplicationError } from "@/application/errors/application-error";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import { positivePoisha } from "@/domain/money/poisha";
import type { AuditEvent, Card, Expense, Household, JoinRequest, ReceiptMetadata, UserProfile } from "@/domain/records/domain-records";
import { auditEventId, cardId, expenseId, householdId, joinRequestId, receiptId, settlementId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { DomainError } from "@/domain/shared/domain-error";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { IndexedDbAtomicApplicationPersistence } from "./atomic-persistence";
import { deleteLocalDatabase, LOCAL_DATABASE_VERSION, openLocalDatabase } from "./database";
import { LocalCurrentSession } from "./development-session";
import { fromExpenseRecord, toExpenseRecord, toSettlementRecord } from "./mappers";
import { IndexedDbRepositories } from "./repositories";
import { deterministicSeedData, SEEDED_HOUSEHOLD_ID, SEEDED_USER_IDS, seedLocalDatabase } from "./seed";

// fake-indexeddb uses Node structured cloning; use Node's Blob in this suite.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

function databaseName(label: string): string {
  return `phase-4-${label}-${crypto.randomUUID()}`;
}

const now = isoInstant("2026-08-13T12:00:00.000Z");

function audit(id: string, aggregateType: AuditEvent["aggregateType"], aggregateId: string): AuditEvent {
  return { auditEventId: auditEventId(`audit-${id}`), householdId: SEEDED_HOUSEHOLD_ID, actorId: SEEDED_USER_IDS.raiyan, aggregateType, aggregateId, action: "test-action", occurredAt: now, changedFields: ["status"] };
}

async function expectApplicationCode(promise: Promise<unknown>, code: ApplicationError["code"]): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "ApplicationError", code });
}

describe("Phase 4 IndexedDB local persistence", () => {
  it("initializes schema v1 without derived financial stores", async () => {
    const name = databaseName("schema");
    const db = await openLocalDatabase(name);
    expect(db.version).toBe(LOCAL_DATABASE_VERSION);
    expect([...db.objectStoreNames]).toEqual([
      "appMeta", "auditEvents", "cards", "developmentSession", "expenseCardPrivateDetails", "expenses", "households", "joinRequests", "memberships", "receiptBlobs", "receiptMetadata", "settlements", "userProfiles",
    ]);
    expect([...db.objectStoreNames]).not.toEqual(expect.arrayContaining(["balances", "recommendations", "dashboardTotals", "analytics"]));
    db.close();
    await deleteLocalDatabase(name);
  });

  it("reports a newer unsupported database version explicitly", async () => {
    const name = databaseName("future-version");
    const future = await openDB(name, LOCAL_DATABASE_VERSION + 1, { upgrade(database) { database.createObjectStore("futureStore"); } });
    future.close();
    await expectApplicationCode(openLocalDatabase(name), "UNSUPPORTED_DATABASE_VERSION");
    await deleteLocalDatabase(name);
  });

  it("reports blocked reset instead of hanging", async () => {
    const name = databaseName("blocked-reset");
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("blocker");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await expectApplicationCode(deleteLocalDatabase(name), "DATABASE_RESET_BLOCKED");
    blocker.close();
    await deleteLocalDatabase(name);
  });

  it("persists repository data across closed and reopened connections", async () => {
    const name = databaseName("reopen");
    let db = await openLocalDatabase(name);
    const repositories = new IndexedDbRepositories(db);
    const profile: UserProfile = { userId: userId("reopen-user"), displayName: "Reopen User", displayEmail: "Reopen@Example.test", emailKey: "reopen@example.test", createdAt: now, updatedAt: now };
    await repositories.profiles.create(profile);
    db.close();
    db = await openLocalDatabase(name);
    expect(await new IndexedDbRepositories(db).profiles.getById(profile.userId)).toEqual(profile);
    db.close();
    await deleteLocalDatabase(name);
  });

  it("enforces unique profile email and household code", async () => {
    const name = databaseName("base-unique");
    const db = await openLocalDatabase(name);
    const repositories = new IndexedDbRepositories(db);
    const first: UserProfile = { userId: userId("profile-one"), displayName: "One", displayEmail: "One@Test.dev", emailKey: "one@test.dev", createdAt: now, updatedAt: now };
    await repositories.profiles.create(first);
    await expectApplicationCode(repositories.profiles.create({ ...first, userId: userId("profile-two") }), "CONFLICT");
    const firstHouse: Household = { householdId: householdId("house-one"), name: "One House", code: "000000001", createdAt: now, updatedAt: now };
    await repositories.households.create(firstHouse);
    await expectApplicationCode(repositories.households.create({ ...firstHouse, householdId: householdId("house-two") }), "CONFLICT");
    db.close(); await deleteLocalDatabase(name);
  });

  it("enforces active membership uniqueness with an optional derived key", async () => {
    const name = databaseName("membership-unique");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).memberships;
    const member = userId("one-house-only");
    await repository.create({ householdId: householdId("house-a"), userId: member, status: "active", role: "member" });
    await expectApplicationCode(repository.create({ householdId: householdId("house-b"), userId: member, status: "active", role: "member" }), "CONFLICT");
    await repository.replace({ householdId: householdId("house-a"), userId: member, status: "former", role: "member" });
    await repository.create({ householdId: householdId("house-b"), userId: member, status: "active", role: "member" });
    expect((await repository.findActiveByUser(member))?.householdId).toBe("house-b");
    db.close(); await deleteLocalDatabase(name);
  });

  it("enforces Pending join uniqueness while retaining terminal history", async () => {
    const name = databaseName("join-unique");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).joinRequests;
    const requester = userId("join-user");
    const first: JoinRequest = { joinRequestId: joinRequestId("join-first"), householdId: householdId("house-a"), userId: requester, status: "pending", createdAt: now };
    await repository.create(first);
    await expectApplicationCode(repository.create({ ...first, joinRequestId: joinRequestId("join-second"), householdId: householdId("house-b") }), "CONFLICT");
    await repository.transition({ ...first, status: "cancelled", resolvedAt: now, resolvedByUserId: requester });
    await repository.create({ ...first, joinRequestId: joinRequestId("join-second"), householdId: householdId("house-b") });
    expect((await repository.listByHousehold(householdId("house-a")))[0]?.status).toBe("cancelled");
    db.close(); await deleteLocalDatabase(name);
  });

  it("canonicalizes unordered Pending settlement uniqueness and releases it at terminal status", async () => {
    const name = databaseName("settlement-unique");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).settlements;
    const first: SettlementRecord = { settlementId: settlementId("settlement-first"), householdId: householdId("house-pair"), senderId: userId("user-a"), receiverId: userId("user-b"), amount: positivePoisha(100), originatingRecommendation: { householdId: householdId("house-pair"), senderId: userId("user-a"), receiverId: userId("user-b"), amount: positivePoisha(100) }, createdAt: now, status: "pending" };
    await repository.createPending(first);
    await expectApplicationCode(repository.createPending({ ...first, settlementId: settlementId("settlement-reverse"), senderId: first.receiverId, receiverId: first.senderId, originatingRecommendation: { ...first.originatingRecommendation, senderId: first.receiverId, receiverId: first.senderId } }), "CONFLICT");
    await repository.transitionPending({ ...first, status: "cancelled", resolvedAt: now });
    await repository.createPending({ ...first, settlementId: settlementId("settlement-reverse"), senderId: first.receiverId, receiverId: first.senderId, originatingRecommendation: { ...first.originatingRecommendation, senderId: first.receiverId, receiverId: first.senderId } });
    db.close(); await deleteLocalDatabase(name);
  });

  it("rejects malformed persisted records without returning private record contents", async () => {
    const name = databaseName("malformed");
    const db = await openLocalDatabase(name);
    await db.put("expenses", { ...toExpenseRecord(deterministicSeedData().expenses[1]), amountPoisha: 1 });
    let caught: unknown;
    try { await new IndexedDbRepositories(db).expenses.getById(expenseId("expense-internet")); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: "MALFORMED_PERSISTED_DATA", context: { store: "expenses", key: "expense-internet" } });
    expect(JSON.stringify(caught)).not.toContain("John Credit");
    db.close(); await deleteLocalDatabase(name);
  });

  it("round-trips validated receipt bytes and removes Blob while retaining tombstone", async () => {
    const name = databaseName("receipt");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).receipts;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const metadata: ReceiptMetadata = { receiptId: receiptId("receipt-test"), householdId: householdId("house-receipt"), expenseId: expenseId("expense-receipt"), createdByUserId: userId("receipt-user"), mimeType: "image/png", originalFilename: "receipt.png", sizeBytes: bytes.length, createdAt: now };
    await repository.create(metadata, { bytes, mimeType: "image/png" });
    const storedBlob = await db.get("receiptBlobs", metadata.receiptId);
    expect(storedBlob).toMatchObject({ recordVersion: 1, receiptId: metadata.receiptId });
    expect({ type: storedBlob?.blob.type, size: storedBlob?.blob.size, arrayBuffer: typeof storedBlob?.blob.arrayBuffer }).toEqual({ type: "image/png", size: bytes.length, arrayBuffer: "function" });
    expect(await repository.readContent(metadata.receiptId)).toEqual({ bytes, mimeType: "image/png" });
    await repository.deleteContentAndTombstone({ ...metadata, deletedAt: now, deletedByUserId: metadata.createdByUserId });
    expect(await repository.readContent(metadata.receiptId)).toBeUndefined();
    expect(await repository.getMetadata(metadata.receiptId)).toMatchObject({ deletedAt: now });
    expect(await db.get("receiptBlobs", metadata.receiptId)).toBeUndefined();
    db.close(); await deleteLocalDatabase(name);
  });

  it("rejects MIME text that does not match receipt byte signatures", async () => {
    const name = databaseName("receipt-signature");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).receipts;
    const metadata: ReceiptMetadata = { receiptId: receiptId("receipt-bad"), householdId: householdId("house-receipt"), expenseId: expenseId("expense-receipt"), createdByUserId: userId("receipt-user"), mimeType: "image/png", sizeBytes: 4, createdAt: now };
    await expectApplicationCode(repository.create(metadata, { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "image/png" }), "RECEIPT_CONTENT_MISMATCH");
    expect(await repository.getMetadata(metadata.receiptId)).toBeUndefined();
    db.close(); await deleteLocalDatabase(name);
  });

  it("rolls back every store when an atomic expense operation fails", async () => {
    const name = databaseName("rollback");
    const db = await openLocalDatabase(name);
    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    const seed = deterministicSeedData();
    const duplicateAudit = audit("duplicate", "expense", "expense-rollback");
    await db.add("auditEvents", { recordVersion: 1, id: duplicateAudit.auditEventId, householdId: duplicateAudit.householdId, actorId: duplicateAudit.actorId, aggregateType: duplicateAudit.aggregateType, aggregateId: duplicateAudit.aggregateId, action: duplicateAudit.action, occurredAt: duplicateAudit.occurredAt, changedFields: duplicateAudit.changedFields });
    const expense: Expense = { ...seed.expenses[0], expenseId: expenseId("expense-rollback"), name: "Rollback" };
    await expectApplicationCode(atomic.createExpense({ expense, receipts: [], auditEvent: duplicateAudit }), "CONFLICT");
    expect(await db.get("expenses", expense.expenseId)).toBeUndefined();
    db.close(); await deleteLocalDatabase(name);
  });

  it("soft-deletes a household and releases active membership keys atomically", async () => {
    const name = databaseName("household-delete");
    const db = await openLocalDatabase(name);
    const repositories = new IndexedDbRepositories(db);
    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    const user = userId("deleting-leader");
    const household: Household = { householdId: householdId("deleting-house"), name: "Deleting House", code: "000000099", createdAt: now, updatedAt: now };
    await repositories.households.create(household);
    await repositories.memberships.create({ householdId: household.householdId, userId: user, status: "active", role: "leader" });
    await atomic.deleteHousehold({ household: { ...household, deletedAt: now, deletedByUserId: user }, formerMemberships: [{ householdId: household.householdId, userId: user, status: "former", role: "leader" }], auditEvent: { ...audit("household-delete", "household", household.householdId), householdId: household.householdId, actorId: user } });
    expect(await repositories.memberships.findActiveByUser(user)).toBeUndefined();
    expect(await repositories.memberships.get(household.householdId, user)).toMatchObject({ status: "former", role: "leader" });
    expect(await repositories.households.getById(household.householdId)).toMatchObject({ deletedAt: now });
    db.close(); await deleteLocalDatabase(name);
  });

  it("never exposes private card history through ordinary expense records or non-owner access", async () => {
    const name = databaseName("privacy");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    const expense = await repositories.expenses.getById(expenseId("expense-internet"));
    expect(expense?.payment).toEqual({ method: "card", cardReference: "private:expense-internet" });
    expect(JSON.stringify(await db.get("expenses", "expense-internet"))).not.toMatch(/John Credit|blue|card-john-credit/);
    expect(await repositories.expenses.getPrivateCardSnapshot(expenseId("expense-internet"), SEEDED_USER_IDS.raiyan)).toBeUndefined();
    expect(await repositories.expenses.getPrivateCardSnapshot(expenseId("expense-internet"), SEEDED_USER_IDS.john)).toMatchObject({ cardName: "John Credit", color: "blue" });
    expect(JSON.stringify(await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID))).not.toMatch(/John Credit|blue|card-john-credit/);
    db.close(); await deleteLocalDatabase(name);
  });

  it("archives referenced cards and physically deletes unreferenced cards", async () => {
    const name = databaseName("card-delete");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    await expectApplicationCode(repositories.cards.deleteUnreferenced(cardId("card-john-credit"), SEEDED_USER_IDS.john), "CONFLICT");
    const referenced = await repositories.cards.getOwned(cardId("card-john-credit"), SEEDED_USER_IDS.john);
    await repositories.cards.archive({ ...referenced!, updatedAt: now, archivedAt: now });
    expect(await repositories.cards.listOwned(SEEDED_USER_IDS.john)).toEqual([]);
    expect(await repositories.expenses.getPrivateCardSnapshot(expenseId("expense-internet"), SEEDED_USER_IDS.john)).toMatchObject({ cardName: "John Credit" });
    const unused: Card = { cardId: cardId("card-unused"), ownerId: SEEDED_USER_IDS.john, name: "Unused", type: "debit", color: "gray", createdAt: now, updatedAt: now };
    await repositories.cards.create(unused);
    await repositories.cards.deleteUnreferenced(unused.cardId, unused.ownerId);
    expect(await repositories.cards.getOwned(unused.cardId, unused.ownerId)).toBeUndefined();
    db.close(); await deleteLocalDatabase(name);
  });

  it("protects confirmed settlements from repository-level rewriting", async () => {
    const name = databaseName("confirmed");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).settlements;
    const confirmed: SettlementRecord = { settlementId: settlementId("settlement-confirmed"), householdId: householdId("house-confirmed"), senderId: userId("sender"), receiverId: userId("receiver"), amount: positivePoisha(500), originatingRecommendation: { householdId: householdId("house-confirmed"), senderId: userId("sender"), receiverId: userId("receiver"), amount: positivePoisha(500) }, createdAt: now, status: "confirmed", resolvedAt: now };
    await db.add("settlements", toSettlementRecord(confirmed));
    await expect(repository.transitionPending({ ...confirmed, status: "rejected" })).rejects.toBeInstanceOf(DomainError);
    expect((await repository.getById(confirmed.settlementId))?.status).toBe("confirmed");
    db.close(); await deleteLocalDatabase(name);
  });

  it("retains former memberships and soft-deleted expense history while excluding deleted balances", async () => {
    const name = databaseName("retention");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    await repositories.memberships.replace({ householdId: SEEDED_HOUSEHOLD_ID, userId: SEEDED_USER_IDS.sarah, status: "former", role: "member" });
    const expense = (await repositories.expenses.getById(expenseId("expense-groceries")))!;
    await repositories.expenses.markDeleted({ ...expense, updatedAt: now, deletedAt: now, deletedByUserId: SEEDED_USER_IDS.raiyan });
    expect((await repositories.memberships.listByHousehold(SEEDED_HOUSEHOLD_ID)).find((item) => item.userId === SEEDED_USER_IDS.sarah)?.status).toBe("former");
    expect((await repositories.expenses.listHouseholdHistory(SEEDED_HOUSEHOLD_ID)).find((item) => item.expenseId === expense.expenseId)?.deletedAt).toBe(now);
    expect(await repositories.expenses.listActiveForBalances(SEEDED_HOUSEHOLD_ID)).toHaveLength(1);
    db.close(); await deleteLocalDatabase(name);
  });

  it("seeds deterministic domain-valid finances and derives rather than persists balances", async () => {
    const first = deterministicSeedData();
    const second = deterministicSeedData();
    expect(first).toEqual(second);
    const sheet = calculateHouseholdBalances(SEEDED_HOUSEHOLD_ID, first.memberships, first.expenses.map((item) => ({ expenseId: item.expenseId, householdId: item.householdId, payerId: item.payerId, amount: item.amount, allocations: item.allocations, deleted: false })), [first.settlement]);
    expect(generateSettlementRecommendations(sheet)).toEqual([
      { householdId: SEEDED_HOUSEHOLD_ID, senderId: SEEDED_USER_IDS.sarah, receiverId: SEEDED_USER_IDS.raiyan, amount: positivePoisha(17500) },
      { householdId: SEEDED_HOUSEHOLD_ID, senderId: SEEDED_USER_IDS.john, receiverId: SEEDED_USER_IDS.raiyan, amount: positivePoisha(2500) },
    ]);
  });

  it("switches identity, persists the selection, and reseeds deterministically", async () => {
    const name = databaseName("session");
    let db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    let session = new LocalCurrentSession(db);
    const observed: string[] = [];
    session.subscribe((id) => observed.push(id));
    await session.switchIdentity(SEEDED_USER_IDS.sarah);
    expect(observed).toEqual([SEEDED_USER_IDS.sarah]);
    db.close();
    db = await openLocalDatabase(name);
    session = new LocalCurrentSession(db);
    expect(await session.getCurrentUserId()).toBe(SEEDED_USER_IDS.sarah);
    db.close();
    await deleteLocalDatabase(name);
    db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    expect(await new LocalCurrentSession(db).getCurrentUserId()).toBe(SEEDED_USER_IDS.raiyan);
    expect(await db.get("appMeta", "seedRevision")).toEqual({ key: "seedRevision", value: "phase-4-v1" });
    db.close(); await deleteLocalDatabase(name);
  });

  it("validates record versions separately from the database schema version", () => {
    const valid = toExpenseRecord(deterministicSeedData().expenses[0]);
    expect(() => fromExpenseRecord({ ...valid, recordVersion: 2 }, valid.id)).toThrowError(ApplicationError);
  });
});
