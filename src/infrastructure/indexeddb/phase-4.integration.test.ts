import "fake-indexeddb/auto";
import { Blob as NodeBlob, Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { openDB } from "idb";

import { ApplicationError } from "@/application/errors/application-error";
import { ReceiptRetentionService } from "@/application/receipts/receipt-retention-service";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import { expenseDate } from "@/domain/dates/expense-date";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import { basisPoints } from "@/domain/money/basis-points";
import { MAX_RECEIPT_BYTES, toBalanceExpense, type AuditEvent, type Card, type Expense, type Household, type JoinRequest, type ReceiptMetadata, type UserProfile } from "@/domain/records/domain-records";
import { markReceiptContentUserDeleted } from "@/domain/receipts/receipt-content-lifecycle";
import { auditEventId, cardId, commandId, expenseId, householdId, joinRequestId, receiptId, settlementId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { DomainError } from "@/domain/shared/domain-error";
import { expensePercentageSourceStatus } from "@/domain/expenses/expense-percentage-source";
import { allocatePercentageSplit } from "@/domain/splits/percentage-split";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { IndexedDbAtomicApplicationPersistence } from "./atomic-persistence";
import { deleteLocalDatabase, LOCAL_DATABASE_VERSION, openLocalDatabase } from "./database";
import { LocalCurrentSession } from "./development-session";
import { fromExpenseRecord, toExpenseRecord, toSettlementRecord } from "./mappers";
import { IndexedDbReceiptRepository, IndexedDbRepositories } from "./repositories";
import { deterministicSeedData, EMPTY_LOCAL_DATABASE_REVISION, initializeLocalDatabase, SEEDED_HOUSEHOLD_ID, SEEDED_USER_IDS, seedLocalDatabase } from "./seed";

// fake-indexeddb uses Node structured cloning; use Node's Blob in this suite.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

function databaseName(label: string): string {
  return `phase-4-${label}-${crypto.randomUUID()}`;
}

const now = isoInstant("2026-08-13T12:00:00.000Z");
const idempotency = (actorId: ReturnType<typeof userId>, commandType: "create-expense" | "create-pending-settlement", label: string) => ({ actorId, commandType, commandId: commandId(label), intentDigest: `test:${label}` });

const receiptFormatFixtures = [
  {
    label: "JPEG",
    mimeType: "image/jpeg" as const,
    bytes: new Uint8Array(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z", "base64")),
  },
  {
    label: "WebP",
    mimeType: "image/webp" as const,
    bytes: new Uint8Array(Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89", "base64")),
  },
] as const;

function paddedJpeg(source: Uint8Array, targetSize: number): Uint8Array {
  const output = new Uint8Array(targetSize);
  output.set(source.slice(0, 2), 0);
  let writeOffset = 2;
  let remaining = targetSize - source.byteLength;
  while (remaining > 0) {
    let segmentSize = Math.min(65_537, remaining);
    const leftover = remaining - segmentSize;
    if (leftover > 0 && leftover < 4) segmentSize -= 4 - leftover;
    const payloadSize = segmentSize - 4;
    output.set([0xff, 0xe2, (payloadSize + 2) >>> 8, (payloadSize + 2) & 0xff], writeOffset);
    writeOffset += segmentSize;
    remaining -= segmentSize;
  }
  output.set(source.slice(2), writeOffset);
  return output;
}

function audit(id: string, aggregateType: AuditEvent["aggregateType"], aggregateId: string): AuditEvent {
  return { auditEventId: auditEventId(`audit-${id}`), householdId: SEEDED_HOUSEHOLD_ID, actorId: SEEDED_USER_IDS.raiyan, aggregateType, aggregateId, action: "test-action", occurredAt: now, changedFields: ["status"] };
}

async function expectApplicationCode(promise: Promise<unknown>, code: ApplicationError["code"]): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "ApplicationError", code });
}

describe("Phase 4 IndexedDB local persistence", () => {
  it("initializes the current schema without derived financial stores", async () => {
    const name = databaseName("schema");
    const db = await openLocalDatabase(name);
    expect(db.version).toBe(LOCAL_DATABASE_VERSION);
    expect([...db.objectStoreNames]).toEqual([
      "appMeta", "auditEvents", "cards", "commandOutcomes", "developmentSession", "expenseCardPrivateDetails", "expenses", "households", "joinRequests", "memberships", "receiptBlobs", "receiptMetadata", "settlements", "userProfiles",
    ]);
    expect([...db.objectStoreNames]).not.toEqual(expect.arrayContaining(["balances", "recommendations", "dashboardTotals", "analytics"]));
    expect([
      ...db.transaction("receiptMetadata").store.indexNames,
    ]).toContain("contentStatusCreatedAt");
    db.close();
    await deleteLocalDatabase(name);
  });

  it("atomically migrates V3 receipt metadata to validated V2 lifecycle records", async () => {
    const name = databaseName("receipt-v4-migration");
    const legacyAvailable = {
      recordVersion: 1 as const,
      id: "receipt-legacy-available",
      householdId: "house-legacy-receipts",
      expenseId: "expense-legacy-available",
      createdByUserId: "user-legacy-uploader",
      mimeType: "image/png" as const,
      originalFilename: "available.png",
      sizeBytes: 12,
      createdAt: "2026-08-20T14:00:00.000Z",
    };
    const legacyDeleted = {
      ...legacyAvailable,
      id: "receipt-legacy-deleted",
      expenseId: "expense-legacy-deleted",
      originalFilename: "deleted.png",
      deletedAt: "2026-08-21T08:00:00.000Z",
      deletedByUserId: "user-legacy-deleter",
    };
    const old = await openDB(name, 3, {
      upgrade(database) {
        const receipts = database.createObjectStore("receiptMetadata", { keyPath: "id" });
        receipts.createIndex("expenseId", "expenseId");
        receipts.createIndex("householdId", "householdId");
        database.createObjectStore("receiptBlobs", { keyPath: "receiptId" });
      },
    });
    await old.add("receiptMetadata", legacyAvailable);
    await old.add("receiptMetadata", legacyDeleted);
    old.close();

    const migrated = await openLocalDatabase(name);
    expect(migrated.version).toBe(5);
    expect(await migrated.get("receiptMetadata", legacyAvailable.id)).toEqual({
      ...legacyAvailable,
      recordVersion: 2,
      contentStatus: "available",
    });
    expect(await migrated.get("receiptMetadata", legacyDeleted.id)).toEqual({
      recordVersion: 2,
      id: legacyDeleted.id,
      householdId: legacyDeleted.householdId,
      expenseId: legacyDeleted.expenseId,
      createdByUserId: legacyDeleted.createdByUserId,
      mimeType: legacyDeleted.mimeType,
      originalFilename: legacyDeleted.originalFilename,
      sizeBytes: legacyDeleted.sizeBytes,
      createdAt: legacyDeleted.createdAt,
      contentStatus: "user-deleted",
      contentRemovedAt: legacyDeleted.deletedAt,
      contentRemovedByUserId: legacyDeleted.deletedByUserId,
    });
    expect([
      ...migrated.transaction("receiptMetadata").store.indexNames,
    ]).toContain("contentStatusCreatedAt");
    migrated.close();
    await deleteLocalDatabase(name);
  });

  it.each([
    {
      label: "missing creation time",
      corrupt: (base: Record<string, unknown>) => {
        const result = { ...base };
        delete result.createdAt;
        return result;
      },
    },
    {
      label: "invalid creation time",
      corrupt: (base: Record<string, unknown>) => ({ ...base, createdAt: "not-an-instant" }),
    },
    {
      label: "incomplete manual deletion",
      corrupt: (base: Record<string, unknown>) => ({ ...base, deletedAt: "2026-08-21T08:00:00.000Z" }),
    },
    {
      label: "contradictory lifecycle fields",
      corrupt: (base: Record<string, unknown>) => ({ ...base, contentStatus: "retention-expired" }),
    },
  ])("rolls back the V3→V4 migration for $label without guessing", async ({ corrupt }) => {
    const name = databaseName("receipt-v4-rollback");
    const valid = {
      recordVersion: 1,
      id: "receipt-valid-before-malformed",
      householdId: "house-legacy-receipts",
      expenseId: "expense-valid-before-malformed",
      createdByUserId: "user-legacy-uploader",
      mimeType: "image/png",
      sizeBytes: 12,
      createdAt: "2026-08-20T14:00:00.000Z",
    };
    const malformed = corrupt({
      ...valid,
      id: "receipt-malformed",
      expenseId: "expense-malformed",
    });
    const old = await openDB(name, 3, {
      upgrade(database) {
        const receipts = database.createObjectStore("receiptMetadata", { keyPath: "id" });
        receipts.createIndex("expenseId", "expenseId");
        receipts.createIndex("householdId", "householdId");
        database.createObjectStore("receiptBlobs", { keyPath: "receiptId" });
      },
    });
    await old.add("receiptMetadata", valid);
    await old.add("receiptMetadata", malformed);
    old.close();

    await expectApplicationCode(openLocalDatabase(name), "MALFORMED_PERSISTED_DATA");
    const unchanged = await openDB(name, 3);
    expect(unchanged.version).toBe(3);
    expect((await unchanged.get("receiptMetadata", valid.id)).recordVersion).toBe(1);
    expect([
      ...unchanged.transaction("receiptMetadata").store.indexNames,
    ]).not.toContain("contentStatusCreatedAt");
    unchanged.close();
    await deleteLocalDatabase(name);
  });

  it("migrates Expense V1 records transactionally without changing allocations", async () => {
    const name = databaseName("expense-v2-migration");
    const current = toExpenseRecord(deterministicSeedData().expenses[0]);
    const currentWithoutPercentageEntries = { ...current };
    delete currentWithoutPercentageEntries.percentageEntries;
    delete (currentWithoutPercentageEntries as Partial<typeof current>).revision;
    const legacy = { ...currentWithoutPercentageEntries, recordVersion: 1 as const };
    const old = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore("expenses", { keyPath: "id" });
      },
    });
    await old.add("expenses", legacy);
    old.close();

    const db = await openLocalDatabase(name);
    expect(await db.get("expenses", legacy.id)).toEqual({
      ...legacy,
      recordVersion: 3,
      revision: 1,
    });
    db.close();
    await deleteLocalDatabase(name);
  });

  it("preserves a legacy percentage expense and its financial allocation without inventing source inputs", async () => {
    const name = databaseName("legacy-percentage");
    const participantIds = [userId("legacy-a"), userId("legacy-b")];
    const amount = positivePoisha(1);
    const source = [
      { participantId: participantIds[0]!, basisPoints: basisPoints(5001) },
      { participantId: participantIds[1]!, basisPoints: basisPoints(4999) },
    ];
    const allocations = allocatePercentageSplit(amount, participantIds, source);
    const legacy = {
      recordVersion: 1 as const,
      id: "expense-legacy-percentage",
      householdId: "house-legacy",
      creatorId: "legacy-a",
      payerId: "legacy-a",
      name: "Legacy percentage",
      amountPoisha: amount,
      expenseDate: "2026-08-18",
      splitMethod: "percentage" as const,
      allocations: allocations.map((allocation) => ({
        participantId: allocation.participantId,
        sharePoisha: allocation.share,
      })),
      paymentMethod: "cash" as const,
      createdAt: now,
      updatedAt: now,
    };
    const old = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore("expenses", { keyPath: "id" });
      },
    });
    await old.add("expenses", legacy);
    old.close();

    const db = await openLocalDatabase(name);
    const expense = await new IndexedDbRepositories(db).expenses.getById(
      expenseId(legacy.id),
    );
    expect(expense?.allocations).toEqual(allocations);
    expect(expense?.percentageEntries).toBeUndefined();
    expect(
      expensePercentageSourceStatus(
        expense!.splitMethod,
        expense!.percentageEntries,
      ),
    ).toBe("legacy-percentage-input-unavailable");
    expect((await db.get("expenses", legacy.id))?.allocations).toEqual(
      legacy.allocations,
    );
    db.close();
    await deleteLocalDatabase(name);
  });

  it("round-trips exact 33.34/33.33/33.33 percentage source with its canonical allocation", async () => {
    const name = databaseName("modern-percentage");
    let db = await openLocalDatabase(name);
    const participantIds = [
      userId("percentage-raiyan"),
      userId("percentage-john"),
      userId("percentage-sarah"),
    ];
    const percentageEntries = [
      { participantId: participantIds[0]!, basisPoints: basisPoints(3334) },
      { participantId: participantIds[1]!, basisPoints: basisPoints(3333) },
      { participantId: participantIds[2]!, basisPoints: basisPoints(3333) },
    ];
    const amount = positivePoisha(10_000);
    const expense: Expense = {
      expenseId: expenseId("expense-modern-percentage"),
      householdId: householdId("house-modern-percentage"),
      creatorId: participantIds[0]!,
      payerId: participantIds[0]!,
      name: "Modern percentage",
      amount,
      expenseDate: expenseDate("2026-08-18"),
      splitMethod: "percentage",
      percentageEntries,
      allocations: allocatePercentageSplit(
        amount,
        participantIds,
        percentageEntries,
      ),
      payment: { method: "cash" },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.add("expenses", toExpenseRecord(expense));
    db.close();

    db = await openLocalDatabase(name);
    const reloaded = await new IndexedDbRepositories(db).expenses.getById(
      expense.expenseId,
    );
    expect(reloaded).toEqual(expense);
    expect(reloaded?.percentageEntries?.map((entry) => entry.basisPoints)).toEqual([
      3334,
      3333,
      3333,
    ]);
    expect(
      allocatePercentageSplit(
        reloaded!.amount,
        reloaded!.allocations.map((allocation) => allocation.participantId),
        reloaded!.percentageEntries!,
      ),
    ).toEqual(reloaded!.allocations);
    db.close();
    await deleteLocalDatabase(name);
  });

  it("rejects malformed percentage source and source/allocation disagreement on reconstruction", async () => {
    const name = databaseName("malformed-percentage-source");
    const db = await openLocalDatabase(name);
    const participantIds = [userId("malformed-a"), userId("malformed-b")];
    const percentageEntries = [
      { participantId: participantIds[0]!, basisPoints: basisPoints(5000) },
      { participantId: participantIds[1]!, basisPoints: basisPoints(5000) },
    ];
    const amount = positivePoisha(101);
    const expense: Expense = {
      expenseId: expenseId("expense-malformed-source"),
      householdId: householdId("house-malformed-source"),
      creatorId: participantIds[0]!,
      payerId: participantIds[0]!,
      name: "Malformed source",
      amount,
      expenseDate: expenseDate("2026-08-18"),
      splitMethod: "percentage",
      percentageEntries,
      allocations: allocatePercentageSplit(
        amount,
        participantIds,
        percentageEntries,
      ),
      payment: { method: "cash" },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const record = toExpenseRecord(expense);
    await db.put("expenses", {
      ...record,
      percentageEntries: [
        { ...record.percentageEntries![0]!, basisPoints: 4999 },
        record.percentageEntries![1]!,
      ],
    });
    await expectApplicationCode(
      new IndexedDbRepositories(db).expenses.getById(expense.expenseId),
      "MALFORMED_PERSISTED_DATA",
    );
    await db.put("expenses", {
      ...record,
      allocations: record.allocations.map((allocation, index) => ({
        ...allocation,
        sharePoisha:
          allocation.sharePoisha + (index === 0 ? -1 : index === 1 ? 1 : 0),
      })),
    });
    await expectApplicationCode(
      new IndexedDbRepositories(db).expenses.getById(expense.expenseId),
      "MALFORMED_PERSISTED_DATA",
    );
    db.close();
    await deleteLocalDatabase(name);
  });

  it("rolls back the full schema migration when any legacy Expense record is malformed", async () => {
    const name = databaseName("migration-rollback");
    const current = toExpenseRecord(deterministicSeedData().expenses[0]);
    const currentWithoutPercentageEntries = { ...current };
    delete currentWithoutPercentageEntries.percentageEntries;
    const validLegacy = {
      ...currentWithoutPercentageEntries,
      recordVersion: 1 as const,
    };
    const old = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore("expenses", { keyPath: "id" });
      },
    });
    await old.add("expenses", validLegacy);
    await old.add("expenses", {
      ...validLegacy,
      id: "expense-malformed-migration",
      name: "",
    });
    old.close();

    await expectApplicationCode(
      openLocalDatabase(name),
      "MALFORMED_PERSISTED_DATA",
    );
    const unchanged = await openDB(name, 1);
    expect((await unchanged.get("expenses", validLegacy.id)).recordVersion).toBe(1);
    expect(
      (await unchanged.get("expenses", "expense-malformed-migration"))
        .recordVersion,
    ).toBe(1);
    unchanged.close();
    await deleteLocalDatabase(name);
  });

  it("migrates every approved legacy Card palette value deterministically", async () => {
    const name = databaseName("card-palette-v3-migration");
    const legacyCards = [
      { id: "card-legacy-lime", color: "lime", expected: "mint" },
      { id: "card-legacy-blue", color: "blue", expected: "powder-blue" },
      { id: "card-legacy-gray", color: "gray", expected: "charcoal" },
    ] as const;
    const old = await openDB(name, 2, {
      upgrade(database) {
        const cards = database.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("ownerId", "ownerId");
        const details = database.createObjectStore("expenseCardPrivateDetails", {
          keyPath: "expenseId",
        });
        details.createIndex("ownerId", "ownerId");
        details.createIndex("cardId", "cardId");
      },
    });
    for (const legacy of legacyCards) {
      await old.add("cards", {
        recordVersion: 1,
        id: legacy.id,
        ownerId: "legacy-owner",
        name: "Private legacy Card",
        type: "debit",
        color: legacy.color,
        createdAt: now,
        updatedAt: now,
      });
    }
    await old.add("expenseCardPrivateDetails", {
      recordVersion: 1,
      expenseId: "expense-legacy-card",
      ownerId: "legacy-owner",
      cardId: "card-legacy-blue",
      cardNameSnapshot: "Historical private Card",
      cardTypeSnapshot: "credit",
      colorSnapshot: "blue",
    });
    old.close();

    const migrated = await openLocalDatabase(name);
    for (const legacy of legacyCards) {
      expect(await migrated.get("cards", legacy.id)).toMatchObject({
        recordVersion: 2,
        colorId: legacy.expected,
      });
    }
    expect(
      await migrated.get("expenseCardPrivateDetails", "expense-legacy-card"),
    ).toMatchObject({ recordVersion: 2, colorIdSnapshot: "powder-blue" });
    migrated.close();
    await deleteLocalDatabase(name);
  });

  it("rejects an unknown private Card palette value without leaking or partially upgrading", async () => {
    const name = databaseName("card-palette-v3-rollback");
    const privateName = "Do not expose this Card name";
    const privateColor = "unsupported-private-neon";
    const old = await openDB(name, 2, {
      upgrade(database) {
        const cards = database.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("ownerId", "ownerId");
        const details = database.createObjectStore("expenseCardPrivateDetails", {
          keyPath: "expenseId",
        });
        details.createIndex("ownerId", "ownerId");
        details.createIndex("cardId", "cardId");
      },
    });
    await old.add("cards", {
      recordVersion: 1,
      id: "card-known-first",
      ownerId: "private-owner",
      name: "Known private Card",
      type: "debit",
      color: "lime",
      createdAt: now,
      updatedAt: now,
    });
    await old.add("cards", {
      recordVersion: 1,
      id: "card-malformed-private",
      ownerId: "private-owner",
      name: privateName,
      type: "credit",
      color: privateColor,
      createdAt: now,
      updatedAt: now,
    });
    old.close();

    const failure = await openLocalDatabase(name).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "ApplicationError",
      code: "MALFORMED_PERSISTED_DATA",
      context: { store: "cards" },
    });
    expect(String((failure as Error).message)).not.toContain(privateName);
    expect(String((failure as Error).message)).not.toContain(privateColor);
    expect(JSON.stringify(failure)).not.toContain("card-malformed-private");

    const unchanged = await openDB(name, 2);
    expect(unchanged.version).toBe(2);
    expect((await unchanged.get("cards", "card-known-first")).recordVersion).toBe(1);
    expect(
      (await unchanged.get("cards", "card-malformed-private")).recordVersion,
    ).toBe(1);
    unchanged.close();
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

  it("atomically revalidates the exact current recommendation before creating a Pending settlement", async () => {
    const name = databaseName("settlement-current-recommendation");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const secondConnection = await openLocalDatabase(name);
    const atomic = new IndexedDbAtomicApplicationPersistence(secondConnection);
    const id = settlementId("settlement-stale-request");
    const staleRequest: SettlementRecord = {
      settlementId: id,
      householdId: SEEDED_HOUSEHOLD_ID,
      senderId: SEEDED_USER_IDS.sarah,
      receiverId: SEEDED_USER_IDS.raiyan,
      amount: positivePoisha(17500),
      originatingRecommendation: {
        householdId: SEEDED_HOUSEHOLD_ID,
        senderId: SEEDED_USER_IDS.sarah,
        receiverId: SEEDED_USER_IDS.raiyan,
        amount: positivePoisha(17500),
      },
      createdAt: now,
      status: "pending",
    };
    const staleAudit: AuditEvent = {
      ...audit("settlement-stale-request", "settlement", id),
      actorId: SEEDED_USER_IDS.sarah,
    };

    const groceries = deterministicSeedData().expenses[0];
    const expenseTransaction = db.transaction("expenses", "readwrite");
    const expenseWrite = expenseTransaction.store.put(toExpenseRecord({
      ...groceries,
      updatedAt: now,
      deletedAt: now,
      deletedByUserId: SEEDED_USER_IDS.raiyan,
    }));
    const staleCreate = atomic.createSettlement({
      idempotency: idempotency(staleRequest.senderId, "create-pending-settlement", "stale-settlement"),
      settlement: staleRequest,
      auditEvent: staleAudit,
    });
    await expenseWrite;
    await expenseTransaction.done;

    await expect(
      staleCreate,
    ).rejects.toMatchObject({
      name: "ApplicationError",
      code: "CONFLICT",
      message: "Settlement recommendation changed. Refresh and try again.",
    });
    expect(await db.get("settlements", id)).toBeUndefined();
    expect(await db.get("auditEvents", staleAudit.auditEventId)).toBeUndefined();
    secondConnection.close(); db.close(); await deleteLocalDatabase(name);
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

  it("rejects a persisted equal expense whose exact-total shares forge the canonical split", async () => {
    const name = databaseName("forged-equal");
    const db = await openLocalDatabase(name);
    const stored = toExpenseRecord(deterministicSeedData().expenses[0]);
    await db.put("expenses", {
      ...stored,
      allocations: stored.allocations.map((allocation, index) => ({
        ...allocation,
        sharePoisha: index === 0 ? 29_998 : index === 1 ? 1 : 1,
      })),
    });
    await expect(
      new IndexedDbRepositories(db).expenses.getById(expenseId(stored.id)),
    ).rejects.toMatchObject({ code: "MALFORMED_PERSISTED_DATA" });
    db.close();
    await deleteLocalDatabase(name);
  });

  it("round-trips validated receipt bytes and removes Blob while retaining user-deleted metadata", async () => {
    const name = databaseName("receipt");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).receipts;
    const bytes = deterministicSeedData().receiptBytes;
    const metadata: ReceiptMetadata = { receiptId: receiptId("receipt-test"), householdId: householdId("house-receipt"), expenseId: expenseId("expense-receipt"), createdByUserId: userId("receipt-user"), mimeType: "image/png", originalFilename: "receipt.png", sizeBytes: bytes.length, createdAt: now, contentStatus: "available" };
    await repository.create(metadata, { bytes, mimeType: "image/png" });
    const storedBlob = await db.get("receiptBlobs", metadata.receiptId);
    expect(storedBlob).toMatchObject({ recordVersion: 1, receiptId: metadata.receiptId });
    expect({ type: storedBlob?.blob.type, size: storedBlob?.blob.size, arrayBuffer: typeof storedBlob?.blob.arrayBuffer }).toEqual({ type: "image/png", size: bytes.length, arrayBuffer: "function" });
    expect(await repository.readContent(metadata.receiptId)).toEqual({ bytes, mimeType: "image/png" });
    expect(await repository.availableBytesByUploader(metadata.createdByUserId)).toBe(bytes.length);
    await repository.deleteContentAndMarkUserDeleted(markReceiptContentUserDeleted(metadata, now, metadata.createdByUserId));
    expect(await repository.readContent(metadata.receiptId)).toBeUndefined();
    expect(await repository.getMetadata(metadata.receiptId)).toMatchObject({ contentStatus: "user-deleted", contentRemovedAt: now, contentRemovedByUserId: metadata.createdByUserId });
    expect(await repository.availableBytesByUploader(metadata.createdByUserId)).toBe(0);
    expect(await db.get("receiptBlobs", metadata.receiptId)).toBeUndefined();
    db.close(); await deleteLocalDatabase(name);
  });

  it("keeps an available missing Blob as an integrity failure except inside eligible retention", async () => {
    const name = databaseName("receipt-missing-retention-recovery");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbReceiptRepository(db);
    const bytes = deterministicSeedData().receiptBytes;
    const metadata: ReceiptMetadata = {
      receiptId: receiptId("receipt-eligible-missing"),
      householdId: householdId("house-receipt-retention"),
      expenseId: expenseId("expense-receipt-retention"),
      createdByUserId: userId("receipt-uploader"),
      mimeType: "image/png",
      originalFilename: "eligible.png",
      sizeBytes: bytes.byteLength,
      createdAt: isoInstant("2026-05-31T17:59:59.999Z"),
      contentStatus: "available",
    };
    await repository.create(metadata, { bytes, mimeType: metadata.mimeType });
    await db.delete("receiptBlobs", metadata.receiptId);

    await expect(repository.readContent(metadata.receiptId)).rejects.toMatchObject({
      code: "MALFORMED_PERSISTED_DATA",
      context: { store: "receiptBlobs", key: metadata.receiptId },
    });
    expect((await repository.getMetadata(metadata.receiptId))?.contentStatus).toBe("available");

    const first = await new ReceiptRetentionService(repository).run({ now });
    expect(first).toMatchObject({
      candidatesProcessed: 1,
      filesAlreadyMissing: 1,
      transitioned: 1,
      failures: 0,
    });
    expect(await repository.getMetadata(metadata.receiptId)).toEqual({
      ...metadata,
      contentStatus: "retention-expired",
      contentRemovedAt: now,
    });
    await expect(repository.readContent(metadata.receiptId)).resolves.toBeUndefined();

    const repeated = await new ReceiptRetentionService(repository).run({ now });
    expect(repeated).toMatchObject({ candidatesProcessed: 0, transitioned: 0, failures: 0 });
    db.close();
    await deleteLocalDatabase(name);
  });

  it("expires content normally for a soft-deleted Expense in a tombstoned Household", async () => {
    const name = databaseName("receipt-retention-deleted-owners");
    const db = await openLocalDatabase(name);
    const repositories = new IndexedDbRepositories(db);
    const retentionRepository = new IndexedDbReceiptRepository(db);
    const actor = userId("retention-history-user");
    const household: Household = {
      householdId: householdId("retention-history-house"),
      name: "Retention History House",
      code: "000000088",
      createdAt: now,
      updatedAt: now,
    };
    const expense: Expense = {
      expenseId: expenseId("retention-history-expense"),
      householdId: household.householdId,
      creatorId: actor,
      payerId: actor,
      name: "Historical receipt owner",
      amount: positivePoisha(500),
      expenseDate: expenseDate("2026-01-05"),
      splitMethod: "amount",
      allocations: [{ participantId: actor, share: poisha(500) }],
      payment: { method: "cash" },
      revision: 1,
      createdAt: isoInstant("2026-01-05T10:00:00.000Z"),
      updatedAt: now,
    };
    await repositories.households.create(household);
    await db.add("expenses", toExpenseRecord(expense));
    await repositories.households.markDeleted({
      ...household,
      updatedAt: now,
      deletedAt: now,
      deletedByUserId: actor,
    });
    await db.put("expenses", toExpenseRecord({
      ...expense,
      updatedAt: now,
      deletedAt: now,
      deletedByUserId: actor,
    }));
    const bytes = deterministicSeedData().receiptBytes;
    const metadata: ReceiptMetadata = {
      receiptId: receiptId("retention-history-receipt"),
      householdId: household.householdId,
      expenseId: expense.expenseId,
      createdByUserId: actor,
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      createdAt: isoInstant("2026-05-01T00:00:00.000Z"),
      contentStatus: "available",
    };
    await retentionRepository.create(metadata, { bytes, mimeType: metadata.mimeType });
    const householdBefore = await repositories.households.getById(household.householdId);
    const expenseBefore = await repositories.expenses.getById(expense.expenseId);

    const result = await new ReceiptRetentionService(retentionRepository).run({ now });

    expect(result).toMatchObject({ candidatesProcessed: 1, filesRemoved: 1, transitioned: 1, failures: 0 });
    expect(await repositories.households.getById(household.householdId)).toEqual(householdBefore);
    expect(await repositories.expenses.getById(expense.expenseId)).toEqual(expenseBefore);
    expect(await retentionRepository.getMetadata(metadata.receiptId)).toMatchObject({
      contentStatus: "retention-expired",
      contentRemovedAt: now,
    });
    db.close();
    await deleteLocalDatabase(name);
  });

  it.each(receiptFormatFixtures)("round-trips a valid $label receipt after close and reopen", async ({ label, mimeType, bytes }) => {
    const name = databaseName(`receipt-${label.toLowerCase()}`);
    let db = await openLocalDatabase(name);
    const metadata: ReceiptMetadata = {
      receiptId: receiptId(`receipt-${label.toLowerCase()}`),
      householdId: householdId("house-receipt-formats"),
      expenseId: expenseId("expense-receipt-formats"),
      createdByUserId: userId("receipt-user"),
      mimeType,
      sizeBytes: bytes.byteLength,
      createdAt: now,
      contentStatus: "available",
    };
    await new IndexedDbRepositories(db).receipts.create(metadata, { bytes, mimeType });
    db.close();

    db = await openLocalDatabase(name);
    await expect(new IndexedDbRepositories(db).receipts.readContent(metadata.receiptId)).resolves.toEqual({ bytes, mimeType });
    db.close();
    await deleteLocalDatabase(name);
  });

  it("persists an exact 10 MiB valid receipt and rejects oversized content before writing", async () => {
    const name = databaseName("receipt-max-boundary");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).receipts;
    const maximum = paddedJpeg(receiptFormatFixtures[0].bytes, MAX_RECEIPT_BYTES);
    const metadata: ReceiptMetadata = {
      receiptId: receiptId("receipt-maximum"),
      householdId: householdId("house-receipt-boundary"),
      expenseId: expenseId("expense-receipt-boundary"),
      createdByUserId: userId("receipt-user"),
      mimeType: "image/jpeg",
      sizeBytes: maximum.byteLength,
      createdAt: now,
      contentStatus: "available",
    };
    await repository.create(metadata, { bytes: maximum, mimeType: "image/jpeg" });
    expect((await repository.readContent(metadata.receiptId))?.bytes).toHaveLength(MAX_RECEIPT_BYTES);

    const oversized = paddedJpeg(receiptFormatFixtures[0].bytes, MAX_RECEIPT_BYTES + 1);
    const oversizedMetadata = { ...metadata, receiptId: receiptId("receipt-oversized"), sizeBytes: oversized.byteLength };
    await expect(repository.create(oversizedMetadata, { bytes: oversized, mimeType: "image/jpeg" })).rejects.toMatchObject({ code: "INVALID_RECEIPT" });
    expect(await repository.getMetadata(oversizedMetadata.receiptId)).toBeUndefined();
    db.close();
    await deleteLocalDatabase(name);
  });

  it("rejects MIME text that does not match receipt byte signatures", async () => {
    const name = databaseName("receipt-signature");
    const db = await openLocalDatabase(name);
    const repository = new IndexedDbRepositories(db).receipts;
    const metadata: ReceiptMetadata = { receiptId: receiptId("receipt-bad"), householdId: householdId("house-receipt"), expenseId: expenseId("expense-receipt"), createdByUserId: userId("receipt-user"), mimeType: "image/png", sizeBytes: 4, createdAt: now, contentStatus: "available" };
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
    await expectApplicationCode(atomic.createExpense({ expense, receipts: [], idempotency: idempotency(expense.creatorId, "create-expense", "rollback-expense"), commandId: commandId("rollback-expense"), auditEvent: duplicateAudit }), "CONFLICT");
    expect(await db.get("expenses", expense.expenseId)).toBeUndefined();
    db.close(); await deleteLocalDatabase(name);
  });

  it("rejects and rolls back an expense that would overflow exact monthly analytics", async () => {
    const name = databaseName("aggregate-overflow-create");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    const expense: Expense = {
      ...deterministicSeedData().expenses[0],
      expenseId: expenseId("expense-aggregate-overflow"),
      name: "Maximum self expense",
      amount: positivePoisha(Number.MAX_SAFE_INTEGER),
      splitMethod: "amount",
      allocations: [{ participantId: SEEDED_USER_IDS.raiyan, share: poisha(Number.MAX_SAFE_INTEGER) }],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    await expect(
      atomic.createExpense({
        expense,
        receipts: [],
        idempotency: idempotency(expense.creatorId, "create-expense", "overflow-expense"),
        commandId: commandId("overflow-expense"),
        auditEvent: audit("aggregate-overflow-create", "expense", expense.expenseId),
      }),
    ).rejects.toMatchObject({ code: "MONEY_OVERFLOW" });
    expect(await db.get("expenses", expense.expenseId)).toBeUndefined();
    db.close();
    await deleteLocalDatabase(name);
  });

  it("rejects and rolls back an edit that would overflow exact monthly analytics", async () => {
    const name = databaseName("aggregate-overflow-edit");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    const original = (await repositories.expenses.getById(expenseId("expense-groceries")))!;
    await expect(
      new IndexedDbAtomicApplicationPersistence(db).editExpense({
        expectedExpenseId: original.expenseId,
        expense: {
          ...original,
          amount: positivePoisha(Number.MAX_SAFE_INTEGER),
          splitMethod: "amount",
          allocations: [{ participantId: SEEDED_USER_IDS.raiyan, share: poisha(Number.MAX_SAFE_INTEGER) }],
          revision: original.revision + 1,
          updatedAt: now,
        },
        expectedRevision: original.revision,
        auditEvents: [audit("aggregate-overflow-edit", "expense", original.expenseId)],
      }),
    ).rejects.toMatchObject({ code: "MONEY_OVERFLOW" });
    expect((await repositories.expenses.getById(original.expenseId))?.amount).toBe(original.amount);
    db.close();
    await deleteLocalDatabase(name);
  });

  it("serializes Household closure ahead of stale receipt deletion and retains history", async () => {
    const name = databaseName("receipt-household-race");
    const db = await openLocalDatabase(name);
    const repositories = new IndexedDbRepositories(db);
    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    const actor = userId("receipt-race-leader");
    const household: Household = {
      householdId: householdId("receipt-race-house"), name: "Receipt Race House", code: "000000077", createdAt: now, updatedAt: now,
    };
    const expense: Expense = {
      expenseId: expenseId("receipt-race-expense"), householdId: household.householdId,
      creatorId: actor, payerId: actor, name: "Self expense", amount: positivePoisha(1),
      expenseDate: expenseDate("2026-08-20"), splitMethod: "amount",
      allocations: [{ participantId: actor, share: poisha(1) }], payment: { method: "cash" },
      revision: 1,
      createdAt: now, updatedAt: now,
    };
    const bytes = deterministicSeedData().receiptBytes;
    const metadata: ReceiptMetadata = {
      receiptId: receiptId("receipt-race"), householdId: household.householdId,
      expenseId: expense.expenseId, createdByUserId: actor, mimeType: "image/png",
      sizeBytes: bytes.byteLength, createdAt: now, contentStatus: "available",
    };
    await repositories.households.create(household);
    await repositories.memberships.create({ householdId: household.householdId, userId: actor, status: "active", role: "leader" });
    await db.add("expenses", toExpenseRecord(expense));
    await repositories.receipts.create(metadata, { bytes, mimeType: "image/png" });

    const close = atomic.deleteHousehold({
      householdId: household.householdId, actorId: actor,
      auditEvent: { ...audit("receipt-race-close", "household", household.householdId), householdId: household.householdId, actorId: actor },
      joinRequestAuditIdBase: auditEventId("audit-receipt-race-joins"),
    });
    const remove = atomic.deleteReceipt({
      metadata: markReceiptContentUserDeleted(metadata, now, actor),
      auditEvent: { ...audit("receipt-race-remove", "receipt", metadata.receiptId), householdId: household.householdId, actorId: actor },
    });
    const [closeResult, removeResult] = await Promise.allSettled([close, remove]);
    expect(closeResult.status).toBe("fulfilled");
    expect(removeResult).toMatchObject({ status: "rejected", reason: { code: "HOUSEHOLD_STATE_CHANGED" } });
    expect(await repositories.receipts.readContent(metadata.receiptId)).toEqual({ bytes, mimeType: "image/png" });
    expect(await repositories.receipts.getMetadata(metadata.receiptId)).toMatchObject({ contentStatus: "available" });
    db.close();
    await deleteLocalDatabase(name);
  });

  it("rolls back expense and staged receipt edits together", async () => {
    const name = databaseName("edit-receipt-rollback");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    const existingReceipt = (await repositories.receipts.listForExpense(
      original.expenseId,
    ))[0]!;
    const duplicateAudit = audit(
      "edit-receipt-duplicate",
      "expense",
      original.expenseId,
    );
    await db.add("auditEvents", {
      recordVersion: 1,
      id: duplicateAudit.auditEventId,
      householdId: duplicateAudit.householdId,
      actorId: duplicateAudit.actorId,
      aggregateType: duplicateAudit.aggregateType,
      aggregateId: duplicateAudit.aggregateId,
      action: duplicateAudit.action,
      occurredAt: duplicateAudit.occurredAt,
      changedFields: duplicateAudit.changedFields,
    });
    const bytes = deterministicSeedData().receiptBytes;
    const added: ReceiptMetadata = {
      receiptId: receiptId("receipt-edit-added"),
      householdId: original.householdId,
      expenseId: original.expenseId,
      createdByUserId: SEEDED_USER_IDS.raiyan,
      mimeType: "image/png",
      originalFilename: "added.png",
      sizeBytes: bytes.byteLength,
      createdAt: now,
      contentStatus: "available",
    };
    await expectApplicationCode(
      atomic.editExpense({
        expectedExpenseId: original.expenseId,
        expense: { ...original, name: "Should roll back", revision: original.revision + 1, updatedAt: now },
        expectedRevision: original.revision,
        receiptAdditions: [
          { metadata: added, content: { bytes, mimeType: "image/png" } },
        ],
        receiptRemovals: [
          markReceiptContentUserDeleted(existingReceipt, now, SEEDED_USER_IDS.raiyan),
        ],
        auditEvents: [duplicateAudit],
      }),
      "CONFLICT",
    );
    expect((await repositories.expenses.getById(original.expenseId))?.name).toBe(
      original.name,
    );
    expect(await repositories.receipts.getMetadata(existingReceipt.receiptId)).not.toHaveProperty("deletedAt");
    expect(await repositories.receipts.readContent(existingReceipt.receiptId)).toBeDefined();
    expect(await repositories.receipts.getMetadata(added.receiptId)).toBeUndefined();
    db.close();
    await deleteLocalDatabase(name);
  });

  it("rechecks former-member financial protection inside the edit transaction", async () => {
    const name = databaseName("edit-membership-race");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    await repositories.memberships.replace({
      householdId: original.householdId,
      userId: SEEDED_USER_IDS.sarah,
      status: "former",
      role: "member",
    });
    const changed: Expense = {
      ...original,
      amount: positivePoisha(30_003),
      allocations: original.allocations.map((allocation) => ({
        ...allocation,
        share: poisha(allocation.share + 1),
      })),
      updatedAt: now,
      revision: original.revision + 1,
    };
    await expect(
      new IndexedDbAtomicApplicationPersistence(db).editExpense({
        expectedExpenseId: original.expenseId,
        expense: changed,
        expectedRevision: original.revision,
        auditEvents: [audit("membership-race", "expense", original.expenseId)],
      }),
    ).rejects.toMatchObject({ code: "FORMER_MEMBER_FINANCIAL_HISTORY_FROZEN" });
    expect((await repositories.expenses.getById(original.expenseId))?.amount).toBe(
      original.amount,
    );
    db.close();
    await deleteLocalDatabase(name);
  });

  it("rolls back stale financial, receipt, private Card, and audit writes after confirmation", async () => {
    const name = databaseName("confirmed-expense-edit-race");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    const original = (await repositories.expenses.getById(
      expenseId("expense-internet"),
    ))!;
    const replacementCard: Card = {
      cardId: cardId("card-john-race-replacement"),
      ownerId: SEEDED_USER_IDS.john,
      name: "Race replacement",
      type: "debit",
      colorId: "soft-coral",
      createdAt: now,
      updatedAt: now,
    };
    await repositories.cards.create(replacementCard);
    const confirmed: SettlementRecord = {
      settlementId: settlementId("settlement-expense-edit-race"),
      householdId: SEEDED_HOUSEHOLD_ID,
      senderId: SEEDED_USER_IDS.sarah,
      receiverId: SEEDED_USER_IDS.raiyan,
      amount: positivePoisha(500),
      originatingRecommendation: {
        householdId: SEEDED_HOUSEHOLD_ID,
        senderId: SEEDED_USER_IDS.sarah,
        receiverId: SEEDED_USER_IDS.raiyan,
        amount: positivePoisha(500),
      },
      createdAt: isoInstant("2026-08-13T01:00:00.000Z"),
      status: "confirmed",
      resolvedAt: now,
    };
    await db.add("settlements", toSettlementRecord(confirmed));
    const receiptBytes = deterministicSeedData().receiptBytes;
    const receipt: ReceiptMetadata = {
      receiptId: receiptId("receipt-confirmed-race"),
      householdId: original.householdId,
      expenseId: original.expenseId,
      createdByUserId: SEEDED_USER_IDS.john,
      mimeType: "image/png",
      originalFilename: "race.png",
      sizeBytes: receiptBytes.byteLength,
      createdAt: now,
      contentStatus: "available",
    };
    const editAudit: AuditEvent = {
      ...audit("confirmed-edit-race", "expense", original.expenseId),
      actorId: SEEDED_USER_IDS.john,
    };
    const privateBefore = await db.get(
      "expenseCardPrivateDetails",
      original.expenseId,
    );
    const settlementBefore = await db.get(
      "settlements",
      confirmed.settlementId,
    );
    const memberships = await repositories.memberships.listByHousehold(
      SEEDED_HOUSEHOLD_ID,
    );
    const expensesBefore = await repositories.expenses.listHouseholdHistory(
      SEEDED_HOUSEHOLD_ID,
    );
    const settlementsBefore = await repositories.settlements.listByHousehold(
      SEEDED_HOUSEHOLD_ID,
    );
    const sheetBefore = calculateHouseholdBalances(
      SEEDED_HOUSEHOLD_ID,
      memberships,
      expensesBefore.map(toBalanceExpense),
      settlementsBefore,
    );
    const recommendationsBefore = generateSettlementRecommendations(sheetBefore);

    await expect(
      atomic.editExpense({
        expectedExpenseId: original.expenseId,
        expense: {
          ...original,
          amount: positivePoisha(15_002),
          allocations: original.allocations.map((allocation) => ({
            ...allocation,
            share: poisha(7_501),
          })),
          revision: original.revision + 1,
          updatedAt: now,
        },
        expectedRevision: original.revision,
        selectedCardId: replacementCard.cardId,
        receiptAdditions: [
          { metadata: receipt, content: { bytes: receiptBytes, mimeType: "image/png" } },
        ],
        auditEvents: [editAudit],
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });

    expect(await repositories.expenses.getById(original.expenseId)).toEqual(
      original,
    );
    expect(await repositories.receipts.getMetadata(receipt.receiptId)).toBeUndefined();
    expect(await db.get("receiptBlobs", receipt.receiptId)).toBeUndefined();
    expect(await db.get("expenseCardPrivateDetails", original.expenseId)).toEqual(
      privateBefore,
    );
    expect(await db.get("auditEvents", editAudit.auditEventId)).toBeUndefined();
    expect(await db.get("settlements", confirmed.settlementId)).toEqual(
      settlementBefore,
    );

    const expensesAfter = await repositories.expenses.listHouseholdHistory(
      SEEDED_HOUSEHOLD_ID,
    );
    const settlementsAfter = await repositories.settlements.listByHousehold(
      SEEDED_HOUSEHOLD_ID,
    );
    const sheetAfter = calculateHouseholdBalances(
      SEEDED_HOUSEHOLD_ID,
      memberships,
      expensesAfter.map(toBalanceExpense),
      settlementsAfter,
    );
    expect(sheetAfter).toEqual(sheetBefore);
    expect(generateSettlementRecommendations(sheetAfter)).toEqual(
      recommendationsBefore,
    );
    db.close();
    await deleteLocalDatabase(name);
  });

  it("rejects stale soft deletion after confirmation with no audit write", async () => {
    const name = databaseName("confirmed-expense-delete-race");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    const confirmed: SettlementRecord = {
      settlementId: settlementId("settlement-expense-delete-race"),
      householdId: SEEDED_HOUSEHOLD_ID,
      senderId: SEEDED_USER_IDS.sarah,
      receiverId: SEEDED_USER_IDS.raiyan,
      amount: positivePoisha(500),
      originatingRecommendation: {
        householdId: SEEDED_HOUSEHOLD_ID,
        senderId: SEEDED_USER_IDS.sarah,
        receiverId: SEEDED_USER_IDS.raiyan,
        amount: positivePoisha(500),
      },
      createdAt: isoInstant("2026-08-13T01:00:00.000Z"),
      status: "confirmed",
      resolvedAt: now,
    };
    await db.add("settlements", toSettlementRecord(confirmed));
    const deleteAudit = audit(
      "confirmed-delete-race",
      "expense",
      original.expenseId,
    );
    await expect(
      new IndexedDbAtomicApplicationPersistence(db).editExpense({
        expectedExpenseId: original.expenseId,
        expense: {
          ...original,
          revision: original.revision + 1,
          updatedAt: now,
          deletedAt: now,
          deletedByUserId: SEEDED_USER_IDS.raiyan,
        },
        expectedRevision: original.revision,
        auditEvents: [deleteAudit],
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });
    expect(await repositories.expenses.getById(original.expenseId)).toEqual(
      original,
    );
    expect(await db.get("auditEvents", deleteAudit.auditEventId)).toBeUndefined();
    db.close();
    await deleteLocalDatabase(name);
  });

  it("treats Expense identity and createdAt as immutable replacement history", async () => {
    const name = databaseName("expense-identity-immutable");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    const repositories = new IndexedDbRepositories(db);
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    const replacements: readonly Readonly<{
      label: string;
      expense: Expense;
      code: "CONFLICT";
    }>[] = [
      {
        label: "expenseId",
        expense: { ...original, expenseId: expenseId("expense-rekeyed") },
        code: "CONFLICT",
      },
      {
        label: "householdId",
        expense: { ...original, householdId: householdId("house-other") },
        code: "CONFLICT",
      },
      {
        label: "creatorId",
        expense: {
          ...original,
          creatorId: SEEDED_USER_IDS.john,
          payerId: SEEDED_USER_IDS.john,
        },
        code: "CONFLICT",
      },
      {
        label: "createdAt",
        expense: {
          ...original,
          createdAt: isoInstant("2026-08-13T00:00:00.001Z"),
        },
        code: "CONFLICT",
      },
    ];

    for (const replacement of replacements) {
      await expect(
        atomic.editExpense({
          expectedExpenseId: original.expenseId,
          expense: { ...replacement.expense, revision: original.revision + 1, updatedAt: now },
          expectedRevision: original.revision,
          auditEvents: [
            audit(
              `identity-${replacement.label}`,
              "expense",
              replacement.expense.expenseId,
            ),
          ],
        }),
      ).rejects.toMatchObject({ code: replacement.code });
    }
    expect(await repositories.expenses.getById(original.expenseId)).toEqual(
      original,
    );
    expect(await repositories.expenses.getById(expenseId("expense-rekeyed"))).toBeUndefined();
    db.close();
    await deleteLocalDatabase(name);
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
    await atomic.deleteHousehold({
      householdId: household.householdId,
      actorId: user,
      auditEvent: { ...audit("household-delete", "household", household.householdId), householdId: household.householdId, actorId: user },
      joinRequestAuditIdBase: auditEventId("audit-household-delete-joins"),
    });
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
    expect(await repositories.expenses.getPrivateCardSnapshot(expenseId("expense-internet"), SEEDED_USER_IDS.john)).toMatchObject({ cardName: "John Credit", colorId: "powder-blue" });
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
    const unused: Card = { cardId: cardId("card-unused"), ownerId: SEEDED_USER_IDS.john, name: "Unused", type: "debit", colorId: "charcoal", createdAt: now, updatedAt: now };
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
    await db.put("expenses", toExpenseRecord({ ...expense, updatedAt: now, deletedAt: now, deletedByUserId: SEEDED_USER_IDS.raiyan }));
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

  it("clears the old browser seed and initializes only development identities", async () => {
    const name = databaseName("empty-bootstrap");
    const db = await openLocalDatabase(name);
    await seedLocalDatabase(db);

    await initializeLocalDatabase(db);

    expect(await db.getAll("userProfiles")).toHaveLength(4);
    expect(await db.getAll("households")).toEqual([]);
    expect(await db.getAll("memberships")).toEqual([]);
    expect(await db.getAll("joinRequests")).toEqual([]);
    expect(await db.getAll("expenses")).toEqual([]);
    expect(await db.getAll("cards")).toEqual([]);
    expect(await db.getAll("settlements")).toEqual([]);
    expect(await db.getAll("receiptMetadata")).toEqual([]);
    expect(await db.getAll("receiptBlobs")).toEqual([]);
    expect(await db.getAll("auditEvents")).toEqual([]);
    expect(await new LocalCurrentSession(db).getCurrentUserId()).toBe(SEEDED_USER_IDS.raiyan);
    expect(await db.get("appMeta", "seedRevision")).toEqual({
      key: "seedRevision",
      value: EMPTY_LOCAL_DATABASE_REVISION,
    });

    db.close();
    await deleteLocalDatabase(name);
  });

  it("validates record versions separately from the database schema version", () => {
    const valid = toExpenseRecord(deterministicSeedData().expenses[0]);
    expect(() => fromExpenseRecord({ ...valid, recordVersion: 2 }, valid.id)).toThrowError(ApplicationError);
  });
});
