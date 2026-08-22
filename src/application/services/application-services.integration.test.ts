import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expenseDate } from "@/domain/dates/expense-date";
import { positivePoisha } from "@/domain/money/poisha";
import { poisha } from "@/domain/money/poisha";
import { basisPoints } from "@/domain/money/basis-points";
import { commandId, expenseId, receiptId, settlementId, userId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";
import { allocatePercentageSplit } from "@/domain/splits/percentage-split";
import { allocateEqualSplit } from "@/domain/splits/equal-split";
import type { Expense } from "@/domain/records/domain-records";
import { IndexedDbAtomicApplicationPersistence } from "@/infrastructure/indexeddb/atomic-persistence";
import { deleteLocalDatabase, openLocalDatabase } from "@/infrastructure/indexeddb/database";
import { LocalCurrentSession } from "@/infrastructure/indexeddb/development-session";
import { IndexedDbReceiptRepository, IndexedDbRepositories } from "@/infrastructure/indexeddb/repositories";
import { toExpenseRecord, toReceiptRecord, toSettlementRecord } from "@/infrastructure/indexeddb/mappers";
import { deterministicSeedData, SEEDED_HOUSEHOLD_ID, SEEDED_USER_IDS, seedLocalDatabase } from "@/infrastructure/indexeddb/seed";
import type { IDBPDatabase } from "idb";
import type { HouseFinanceDatabase } from "@/infrastructure/indexeddb/records";
import { HouseFinanceApplication, type ApplicationValues, type GeneratedIdKind } from "./application-services";
import { calendarMonth } from "@/application/analytics/calendar-month";
import { ApplicationError, BackdatedExpenseConfirmationRequiredError } from "@/application/errors/application-error";
import { ReceiptRetentionService } from "@/application/receipts/receipt-retention-service";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";

globalThis.Blob = NodeBlob as unknown as typeof Blob;

class FixedValues implements ApplicationValues {
  private counter = 0;
  now(): IsoInstant { return isoInstant("2026-08-13T13:00:00.000Z"); }
  nextId(kind: GeneratedIdKind): string { this.counter += 1; return `${kind}-test-${this.counter}`; }
  nextHouseholdCodeCandidate(): string { return "987654321"; }
}

function confirmedSettlementRecord(
  id: string,
  resolvedAt: IsoInstant,
): SettlementRecord {
  const amount = positivePoisha(500);
  return {
    settlementId: settlementId(id),
    householdId: SEEDED_HOUSEHOLD_ID,
    senderId: SEEDED_USER_IDS.sarah,
    receiverId: SEEDED_USER_IDS.raiyan,
    amount,
    originatingRecommendation: {
      householdId: SEEDED_HOUSEHOLD_ID,
      senderId: SEEDED_USER_IDS.sarah,
      receiverId: SEEDED_USER_IDS.raiyan,
      amount,
    },
    createdAt: isoInstant("2026-08-13T00:30:00.000Z"),
    status: "confirmed",
    resolvedAt,
  };
}

describe("Phase 4 application services with IndexedDB", () => {
  let name: string;
  let db: IDBPDatabase<HouseFinanceDatabase>;
  let repositories: IndexedDbRepositories;
  let session: LocalCurrentSession;
  let atomic: IndexedDbAtomicApplicationPersistence;
  let application: HouseFinanceApplication;

  beforeEach(async () => {
    name = `application-services-${crypto.randomUUID()}`;
    db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    repositories = new IndexedDbRepositories(db);
    session = new LocalCurrentSession(db);
    atomic = new IndexedDbAtomicApplicationPersistence(db);
    application = new HouseFinanceApplication({ repositories, atomic, session, values: new FixedValues() });
  });

  afterEach(async () => {
    db.close();
    await deleteLocalDatabase(name);
  });

  it("returns private card history only to its owner", async () => {
    const leaderView = await application.expenses.getExpense(expenseId("expense-internet"));
    expect(leaderView.expense.payment).toEqual({ method: "card" });
    expect(leaderView).not.toHaveProperty("privateCardSnapshot");
    expect(JSON.stringify(leaderView)).not.toMatch(/John Credit|blue|card-john-credit/);

    await session.switchIdentity(SEEDED_USER_IDS.john);
    const ownerView = await application.expenses.getExpense(expenseId("expense-internet"));
    expect(ownerView.privateCardSnapshot).toMatchObject({ cardName: "John Credit", cardType: "credit", colorId: "powder-blue" });
  });

  it("derives Dashboard and Monthly Report views without exposing private Card metadata", async () => {
    const dashboard = await application.analytics.getDashboard(
      SEEDED_HOUSEHOLD_ID,
      calendarMonth("2026-08"),
    );
    expect(dashboard.spent).toBe(45_000);
    expect(dashboard.dailySpending).toHaveLength(31);
    expect(dashboard.paymentMix).toEqual({
      total: 45_000,
      cash: { amount: 30_000, basisPoints: 6_667 },
      card: { amount: 15_000, basisPoints: 3_333 },
    });
    expect(dashboard.settlementHealth).toEqual({ outstandingCount: 1, pendingCount: 1 });
    expect(JSON.stringify(dashboard)).not.toMatch(/John Credit|powder-blue|card-john-credit/);

    const report = await application.analytics.getMonthlyReport(
      SEEDED_HOUSEHOLD_ID,
      calendarMonth("2026-08"),
      (instant) => calendarMonth(instant.slice(0, 7)),
    );
    expect(report.expenseCount).toBe(2);
    expect(report.comparison.kind).toBe("no-previous-spending");
    expect(report.settlementActivity.claimsCreated.count).toBe(1);
    expect(report.currentOutstanding).toEqual({ count: 2, total: 20_000 });
    expect(JSON.stringify(report)).not.toMatch(/John Credit|powder-blue|card-john-credit/);
  });

  it("keeps every financial record, calculation, and membership-management gate identical after receipt expiration", async () => {
    const receiptRepository = new IndexedDbReceiptRepository(db);
    const seededReceipt = (await receiptRepository.listForExpense(expenseId("expense-groceries")))[0]!;
    const oldReceipt = {
      ...seededReceipt,
      createdAt: isoInstant("2026-05-31T17:59:59.999Z"),
    };
    await db.put("receiptMetadata", toReceiptRecord(oldReceipt));

    const recordsBefore = {
      profiles: await db.getAll("userProfiles"),
      households: await db.getAll("households"),
      memberships: await db.getAll("memberships"),
      joinRequests: await db.getAll("joinRequests"),
      expenses: await db.getAll("expenses"),
      privateCards: await db.getAll("expenseCardPrivateDetails"),
      settlements: await db.getAll("settlements"),
      cards: await db.getAll("cards"),
      audits: await db.getAll("auditEvents"),
    };
    const derivedBefore = {
      dashboard: await application.analytics.getDashboard(
        SEEDED_HOUSEHOLD_ID,
        calendarMonth("2026-08"),
      ),
      report: await application.analytics.getMonthlyReport(
        SEEDED_HOUSEHOLD_ID,
        calendarMonth("2026-08"),
        (instant) => calendarMonth(instant.slice(0, 7)),
      ),
      recommendations: await application.settlements.recommendations(SEEDED_HOUSEHOLD_ID),
      settlements: await application.settlements.listHouseholdSettlements(SEEDED_HOUSEHOLD_ID),
      householdAccess: await application.households.getCurrentAccessState(),
    };

    const result = await new ReceiptRetentionService(receiptRepository).run({
      now: isoInstant("2026-08-22T10:00:00.000Z"),
    });

    expect(result).toMatchObject({ candidatesProcessed: 1, filesRemoved: 1, transitioned: 1, failures: 0 });
    expect({
      profiles: await db.getAll("userProfiles"),
      households: await db.getAll("households"),
      memberships: await db.getAll("memberships"),
      joinRequests: await db.getAll("joinRequests"),
      expenses: await db.getAll("expenses"),
      privateCards: await db.getAll("expenseCardPrivateDetails"),
      settlements: await db.getAll("settlements"),
      cards: await db.getAll("cards"),
      audits: await db.getAll("auditEvents"),
    }).toEqual(recordsBefore);
    expect({
      dashboard: await application.analytics.getDashboard(
        SEEDED_HOUSEHOLD_ID,
        calendarMonth("2026-08"),
      ),
      report: await application.analytics.getMonthlyReport(
        SEEDED_HOUSEHOLD_ID,
        calendarMonth("2026-08"),
        (instant) => calendarMonth(instant.slice(0, 7)),
      ),
      recommendations: await application.settlements.recommendations(SEEDED_HOUSEHOLD_ID),
      settlements: await application.settlements.listHouseholdSettlements(SEEDED_HOUSEHOLD_ID),
      householdAccess: await application.households.getCurrentAccessState(),
    }).toEqual(derivedBefore);
    expect(await db.get("receiptBlobs", oldReceipt.receiptId)).toBeUndefined();
    expect(await receiptRepository.getMetadata(oldReceipt.receiptId)).toEqual({
      ...oldReceipt,
      contentStatus: "retention-expired",
      contentRemovedAt: isoInstant("2026-08-22T10:00:00.000Z"),
    });
  });

  it("lets a leader preserve an opaque Card expense without loading private metadata", async () => {
    const getPrivate = vi.spyOn(repositories.expenses, "getPrivateCardSnapshot");
    const original = (await repositories.expenses.getById(expenseId("expense-internet")))!;
    const view = await application.expenses.editExpense({ expenseId: original.expenseId, expectedRevision: original.revision, name: "Updated Internet", amount: original.amount, expenseDate: original.expenseDate, splitMethod: original.splitMethod, allocations: original.allocations, payment: { kind: "preserve" } });
    expect(getPrivate).not.toHaveBeenCalled();
    expect(view.expense.name).toBe("Updated Internet");
    expect(view.expense.payment).toEqual({ method: "card" });
    expect(view).not.toHaveProperty("privateCardSnapshot");
    expect(await repositories.expenses.getPrivateCardSnapshot(original.expenseId, SEEDED_USER_IDS.john)).toMatchObject({ cardName: "John Credit" });
  });

  it("enforces non-owner leader Card transition restrictions in the application service", async () => {
    const cardExpense = (await repositories.expenses.getById(
      expenseId("expense-internet"),
    ))!;
    await expect(
      application.expenses.editExpense({
        expenseId: cardExpense.expenseId,
        expectedRevision: cardExpense.revision,
        name: cardExpense.name,
        amount: cardExpense.amount,
        expenseDate: cardExpense.expenseDate,
        splitMethod: cardExpense.splitMethod,
        allocations: cardExpense.allocations,
        payment: { kind: "card", cardId: (await repositories.cards.listOwned(SEEDED_USER_IDS.raiyan))[0]!.cardId },
      }),
    ).rejects.toMatchObject({ code: "PRIVATE_CARD_ACCESS_FORBIDDEN" });

    await session.switchIdentity(SEEDED_USER_IDS.john);
    const johnCash = await application.expenses.createExpense({
      householdId: SEEDED_HOUSEHOLD_ID,
      name: "John cash",
      amount: positivePoisha(100),
      expenseDate: expenseDate("2026-08-13"),
      splitMethod: "amount",
      allocations: [{ participantId: SEEDED_USER_IDS.john, share: poisha(100) }],
      payment: { method: "cash" },
    });
    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    await expect(
      application.expenses.editExpense({
        expenseId: johnCash.expense.expenseId,
        expectedRevision: johnCash.expense.revision,
        name: johnCash.expense.name,
        amount: johnCash.expense.amount,
        expenseDate: johnCash.expense.expenseDate,
        splitMethod: johnCash.expense.splitMethod,
        allocations: johnCash.expense.allocations,
        payment: { kind: "card", cardId: (await repositories.cards.listOwned(SEEDED_USER_IDS.raiyan))[0]!.cardId },
      }),
    ).rejects.toMatchObject({ code: "PRIVATE_CARD_ACCESS_FORBIDDEN" });
  });

  it("allows an archived historical Card association to be preserved but not newly selected", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.john);
    const original = (await repositories.expenses.getById(
      expenseId("expense-internet"),
    ))!;
    const card = (await repositories.cards.listOwned(SEEDED_USER_IDS.john))[0]!;
    await repositories.cards.archive({
      ...card,
      updatedAt: isoInstant("2026-08-13T13:00:00.000Z"),
      archivedAt: isoInstant("2026-08-13T13:00:00.000Z"),
    });
    await expect(
      application.expenses.editExpense({
        expenseId: original.expenseId,
        expectedRevision: original.revision,
        name: "Archived Card preserved",
        amount: original.amount,
        expenseDate: original.expenseDate,
        splitMethod: original.splitMethod,
        allocations: original.allocations,
        payment: { kind: "preserve" },
      }),
    ).resolves.toMatchObject({ expense: { payment: { method: "card" } } });
    await expect(
      application.expenses.editExpense({
        expenseId: original.expenseId,
        expectedRevision: original.revision + 1,
        name: original.name,
        amount: original.amount,
        expenseDate: original.expenseDate,
        splitMethod: original.splitMethod,
        allocations: original.allocations,
        payment: { kind: "card", cardId: card.cardId },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const active = await application.cards.createMyCard({
      name: "Active replacement",
      type: "debit",
      colorId: "soft-coral",
    });
    const switched = await application.expenses.editExpense({
      expenseId: original.expenseId,
      expectedRevision: original.revision + 1,
      name: original.name,
      amount: original.amount,
      expenseDate: original.expenseDate,
      splitMethod: original.splitMethod,
      allocations: original.allocations,
      payment: { kind: "card", cardId: active.cardId },
    });
    expect(switched.privateCardSnapshot).toMatchObject({
      cardId: active.cardId,
      cardName: "Active replacement",
      colorId: "soft-coral",
    });
  });

  it("locks Card association changes without exposing private Card identity", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.john);
    const replacement = await application.cards.createMyCard({
      name: "Locked replacement",
      type: "debit",
      colorId: "soft-coral",
    });
    const cardExpense = (await repositories.expenses.getById(
      expenseId("expense-internet"),
    ))!;
    const privateBefore = await db.get(
      "expenseCardPrivateDetails",
      cardExpense.expenseId,
    );
    await db.add(
      "settlements",
      toSettlementRecord(
        confirmedSettlementRecord(
          "settlement-card-lock",
          isoInstant("2026-08-13T13:00:00.000Z"),
        ),
      ),
    );

    await expect(
      application.expenses.editExpense({
        expenseId: cardExpense.expenseId,
        expectedRevision: cardExpense.revision,
        name: cardExpense.name,
        amount: cardExpense.amount,
        expenseDate: cardExpense.expenseDate,
        splitMethod: cardExpense.splitMethod,
        allocations: cardExpense.allocations,
        payment: { kind: "card", cardId: replacement.cardId },
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });
    await expect(
      application.expenses.editExpense({
        expenseId: cardExpense.expenseId,
        expectedRevision: cardExpense.revision,
        name: cardExpense.name,
        amount: cardExpense.amount,
        expenseDate: cardExpense.expenseDate,
        splitMethod: cardExpense.splitMethod,
        allocations: cardExpense.allocations,
        payment: {
          kind: "cash",
          confirmedPrivateReferenceDetachment: true,
        },
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });
    expect(
      await db.get("expenseCardPrivateDetails", cardExpense.expenseId),
    ).toEqual(privateBefore);

    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    const cashExpense = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    const myCard = (await repositories.cards.listOwned(
      SEEDED_USER_IDS.raiyan,
    ))[0]!;
    await expect(
      application.expenses.editExpense({
        expenseId: cashExpense.expenseId,
        expectedRevision: cashExpense.revision,
        name: cashExpense.name,
        amount: cashExpense.amount,
        expenseDate: cashExpense.expenseDate,
        splitMethod: cashExpense.splitMethod,
        allocations: cashExpense.allocations,
        payment: { kind: "card", cardId: myCard.cardId },
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });

    const leaderView = await application.expenses.getExpense(
      cardExpense.expenseId,
    );
    expect(JSON.stringify(leaderView)).not.toMatch(
      /John Credit|Locked replacement|soft-coral|card-john-credit/,
    );
  });

  it("requires explicit Card-to-Cash confirmation while retaining owner-private history", async () => {
    const original = (await repositories.expenses.getById(expenseId("expense-internet")))!;
    const command = { expenseId: original.expenseId, expectedRevision: original.revision, name: original.name, amount: original.amount, expenseDate: original.expenseDate, splitMethod: original.splitMethod, allocations: original.allocations } as const;
    await expect(application.expenses.editExpense({ ...command, payment: { kind: "cash", confirmedPrivateReferenceDetachment: false } })).rejects.toMatchObject({ code: "PRIVATE_CARD_ACCESS_FORBIDDEN" });
    await application.expenses.editExpense({ ...command, payment: { kind: "cash", confirmedPrivateReferenceDetachment: true } });
    expect(await repositories.expenses.getPrivateCardSnapshot(original.expenseId, SEEDED_USER_IDS.john)).toMatchObject({ cardName: "John Credit" });
    await session.switchIdentity(SEEDED_USER_IDS.john);
    const currentView = await application.expenses.getExpense(original.expenseId);
    expect(currentView.expense.payment).toEqual({ method: "cash" });
    expect(currentView).not.toHaveProperty("privateCardSnapshot");
  });

  it("uses current derived recommendations and persists settlement lifecycle history", async () => {
    const recommendations = await application.settlements.recommendations(SEEDED_HOUSEHOLD_ID);
    expect(recommendations).toContainEqual({ householdId: SEEDED_HOUSEHOLD_ID, senderId: SEEDED_USER_IDS.john, receiverId: SEEDED_USER_IDS.raiyan, amount: positivePoisha(2500) });
    await session.switchIdentity(SEEDED_USER_IDS.john);
    await application.settlements.transitionSettlement(settlementId("settlement-john-raiyan"), "cancelled");
    const createdId = await application.settlements.createSettlement(recommendations.find((item) => item.senderId === SEEDED_USER_IDS.john)!);
    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    await application.settlements.transitionSettlement(createdId, "confirmed");
    expect(await repositories.settlements.getById(createdId)).toMatchObject({ status: "confirmed", amount: 2500 });
    expect((await repositories.settlements.listByHousehold(SEEDED_HOUSEHOLD_ID)).find((item) => item.settlementId === settlementId("settlement-john-raiyan"))?.status).toBe("cancelled");
  });

  it("builds actor-specific settlement views, attention counts, and active-member-only history", async () => {
    const raiyan = await application.settlements.getSettlementPage(SEEDED_HOUSEHOLD_ID);
    expect(raiyan.summary).toEqual({ youOwe: 0, youAreOwed: 20000, settled: false });
    expect(raiyan.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "incoming", counterparty: expect.objectContaining({ displayName: "John" }) }),
      expect.objectContaining({ direction: "incoming", counterparty: expect.objectContaining({ displayName: "Sarah" }) }),
    ]));
    expect(raiyan.pending).toHaveLength(1);
    expect(raiyan.pending[0]).toMatchObject({
      relationship: "receiver",
      allowedActions: { confirm: true, reject: true, cancel: false },
    });
    expect(await application.settlements.countCurrentUserSettlementActions()).toBe(1);

    await session.switchIdentity(SEEDED_USER_IDS.john);
    const john = await application.settlements.getSettlementPage(SEEDED_HOUSEHOLD_ID);
    expect(john.summary).toEqual({ youOwe: 2500, youAreOwed: 0, settled: false });
    expect(john.recommendations[0]).toMatchObject({
      direction: "outgoing",
      canMarkPaid: false,
    });
    expect(john.pending[0]).toMatchObject({
      relationship: "sender",
      allowedActions: { confirm: false, reject: false, cancel: true },
    });
    expect(await application.settlements.countCurrentUserSettlementActions()).toBe(0);

    await session.switchIdentity(SEEDED_USER_IDS.alex);
    await expect(application.settlements.getSettlementPage(SEEDED_HOUSEHOLD_ID))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a stale create when financial state drifts after service prevalidation", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.sarah);
    const requested = (await application.settlements.recommendations(SEEDED_HOUSEHOLD_ID))
      .find((item) => item.senderId === SEEDED_USER_IDS.sarah)!;
    const atomic = new IndexedDbAtomicApplicationPersistence(db);
    const authoritativeCreate = atomic.createSettlement.bind(atomic);
    vi.spyOn(atomic, "createSettlement").mockImplementationOnce(async (input) => {
      const groceries = (await repositories.expenses.getById(expenseId("expense-groceries")))!;
      await db.put("expenses", toExpenseRecord({
        ...groceries,
        updatedAt: isoInstant("2026-08-13T12:59:59.000Z"),
        deletedAt: isoInstant("2026-08-13T12:59:59.000Z"),
        deletedByUserId: SEEDED_USER_IDS.raiyan,
      }));
      return authoritativeCreate(input);
    });
    application = new HouseFinanceApplication({
      repositories,
      atomic,
      session,
      values: new FixedValues(),
    });
    const settlementCount = (await repositories.settlements.listByHousehold(SEEDED_HOUSEHOLD_ID)).length;
    const auditCount = (await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID)).length;

    await expect(application.settlements.createSettlement(requested)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Settlement recommendation changed. Refresh and try again.",
    });
    expect(await repositories.settlements.listByHousehold(SEEDED_HOUSEHOLD_ID)).toHaveLength(settlementCount);
    expect(await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID)).toHaveLength(auditCount);
  });

  it("enforces receiver/sender lifecycle permissions without a leader override", async () => {
    const leaderCannotOverride = {
      settlementId: settlementId("settlement-john-sarah"),
      householdId: SEEDED_HOUSEHOLD_ID,
      senderId: SEEDED_USER_IDS.john,
      receiverId: SEEDED_USER_IDS.sarah,
      amount: positivePoisha(100),
      originatingRecommendation: {
        householdId: SEEDED_HOUSEHOLD_ID,
        senderId: SEEDED_USER_IDS.john,
        receiverId: SEEDED_USER_IDS.sarah,
        amount: positivePoisha(100),
      },
      createdAt: isoInstant("2026-08-13T12:30:00.000Z"),
      status: "pending" as const,
    };
    await db.add("settlements", toSettlementRecord(leaderCannotOverride));
    await expect(application.settlements.confirmSettlement(leaderCannotOverride.settlementId))
      .rejects.toMatchObject({ code: "SETTLEMENT_ACTOR_NOT_RECEIVER" });
    await expect(application.settlements.rejectSettlement(leaderCannotOverride.settlementId))
      .rejects.toMatchObject({ code: "SETTLEMENT_ACTOR_NOT_RECEIVER" });
    await expect(application.settlements.cancelSettlement(leaderCannotOverride.settlementId))
      .rejects.toMatchObject({ code: "SETTLEMENT_ACTOR_NOT_SENDER" });

    await session.switchIdentity(SEEDED_USER_IDS.sarah);
    await expect(
      application.settlements.confirmSettlement(settlementId("settlement-john-raiyan")),
    ).rejects.toMatchObject({ code: "SETTLEMENT_ACTOR_NOT_RECEIVER" });
    await expect(
      application.settlements.cancelSettlement(settlementId("settlement-john-raiyan")),
    ).rejects.toMatchObject({ code: "SETTLEMENT_ACTOR_NOT_SENDER" });

    await session.switchIdentity(SEEDED_USER_IDS.john);
    await application.settlements.cancelSettlement(settlementId("settlement-john-raiyan"));
    await expect(
      application.settlements.cancelSettlement(settlementId("settlement-john-raiyan")),
    ).rejects.toMatchObject({ code: "INVALID_SETTLEMENT_TRANSITION" });
  });

  it("archives referenced cards through the application service", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.john);
    const referencedCard = (await repositories.cards.listOwned(SEEDED_USER_IDS.john))[0]!;
    const removal = await application.cards.getMyCardRemovalPreview(referencedCard.cardId);
    expect(await application.cards.deleteOrArchiveMyCard(referencedCard.cardId, removal.expectedAction)).toBe("archived");
    expect(await repositories.cards.listOwned(SEEDED_USER_IDS.john)).toEqual([]);
    expect(await repositories.cards.listOwned(SEEDED_USER_IDS.john, true)).toHaveLength(1);
  });

  it("authorizes receipt reads and preserves deletion audit without binary payloads", async () => {
    const metadata = (await repositories.receipts.listForExpense(expenseId("expense-groceries")))[0]!;
    const contentRead = vi.spyOn(repositories.receipts, "readContent");
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    await expect(application.receipts.readReceipt(metadata.receiptId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(contentRead).not.toHaveBeenCalled();

    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    const content = await application.receipts.readReceipt(metadata.receiptId);
    expect(content.bytes).toEqual(deterministicSeedData().receiptBytes);
    await application.receipts.deleteReceipt(metadata.receiptId);
    expect(await repositories.receipts.readContent(metadata.receiptId)).toBeUndefined();
    contentRead.mockClear();
    await expect(application.receipts.readReceipt(metadata.receiptId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(contentRead).not.toHaveBeenCalled();
    await expect(application.receipts.deleteReceipt(metadata.receiptId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await repositories.receipts.getMetadata(metadata.receiptId)).toMatchObject({ contentStatus: "user-deleted" });
    const audits = await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID);
    expect(audits.at(-1)).toMatchObject({
      aggregateType: "receipt",
      action: "deleted",
      changedFields: [
        "contentStatus",
        "contentRemovedAt",
        "contentRemovedByUserId",
      ],
    });
    expect(JSON.stringify(audits)).not.toContain("137,80,78,71");
  });

  it("creates a validated expense and receipt atomically through application ports", async () => {
    const png = deterministicSeedData().receiptBytes;
    const view = await application.expenses.createExpense({ householdId: SEEDED_HOUSEHOLD_ID, name: "Tea", amount: positivePoisha(300), expenseDate: expenseDate("2026-08-13"), splitMethod: "equal", allocations: [{ participantId: SEEDED_USER_IDS.john, share: positivePoisha(100) }, { participantId: SEEDED_USER_IDS.raiyan, share: positivePoisha(100) }, { participantId: SEEDED_USER_IDS.sarah, share: positivePoisha(100) }], payment: { method: "cash" }, receipts: [{ originalFilename: "tea.png", content: { bytes: png, mimeType: "image/png" } }] });
    expect(view.expense.name).toBe("Tea");
    const storedReceipts = await repositories.receipts.listForExpense(view.expense.expenseId);
    expect(storedReceipts).toHaveLength(1);
    expect(await repositories.receipts.readContent(storedReceipts[0]!.receiptId)).toEqual({ bytes: png, mimeType: "image/png" });
  });

  it("finishes image decoding before entering the atomic receipt transaction", async () => {
    const decoder = vi.fn(async () => {
      throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt content is not a valid supported image.");
    });
    const write = vi.spyOn(atomic, "createReceipt");
    const validatingApplication = new HouseFinanceApplication({
      repositories,
      atomic,
      session,
      values: new FixedValues(),
      receiptContentDecoder: decoder,
    });

    await expect(validatingApplication.receipts.addReceipt(
      expenseId("expense-groceries"),
      {
        originalFilename: "malformed.png",
        content: { bytes: deterministicSeedData().receiptBytes, mimeType: "image/png" },
      },
    )).rejects.toMatchObject({ code: "RECEIPT_CONTENT_MISMATCH" });
    expect(decoder).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects non-member and former-member participants at the application boundary", async () => {
    await repositories.memberships.replace({
      householdId: SEEDED_HOUSEHOLD_ID,
      userId: SEEDED_USER_IDS.sarah,
      status: "former",
      role: "member",
    });
    const base = {
      householdId: SEEDED_HOUSEHOLD_ID,
      name: "Invalid participant",
      amount: positivePoisha(100),
      expenseDate: expenseDate("2026-08-13"),
      splitMethod: "amount" as const,
      payment: { method: "cash" as const },
    };
    await expect(
      application.expenses.createExpense({
        ...base,
        allocations: [{ participantId: SEEDED_USER_IDS.sarah, share: poisha(100) }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE" });
    await expect(
      application.expenses.createExpense({
        ...base,
        allocations: [
          { participantId: userId("not-a-household-member"), share: poisha(100) },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE" });
  });

  it("persists and preloads exact percentage source entries through create and edit", async () => {
    const participantIds = [
      SEEDED_USER_IDS.raiyan,
      SEEDED_USER_IDS.john,
      SEEDED_USER_IDS.sarah,
    ];
    const percentageEntries = [
      { participantId: participantIds[0], basisPoints: basisPoints(3334) },
      { participantId: participantIds[1], basisPoints: basisPoints(3333) },
      { participantId: participantIds[2], basisPoints: basisPoints(3333) },
    ];
    const amount = positivePoisha(10_000);
    const created = await application.expenses.createExpense({
      householdId: SEEDED_HOUSEHOLD_ID,
      name: "Percentage source",
      amount,
      expenseDate: expenseDate("2026-08-13"),
      splitMethod: "percentage",
      percentageEntries,
      allocations: allocatePercentageSplit(
        amount,
        participantIds,
        percentageEntries,
      ),
      payment: { method: "cash" },
    });
    expect(created.percentageSourceStatus).toBe("available");
    expect(created.expense.percentageEntries).toEqual(percentageEntries);

    const edited = await application.expenses.editExpense({
      expenseId: created.expense.expenseId,
      expectedRevision: created.expense.revision,
      name: "Percentage source renamed",
      amount: created.expense.amount,
      expenseDate: created.expense.expenseDate,
      splitMethod: "percentage",
      allocations: created.expense.allocations,
      payment: { kind: "preserve" },
    });
    expect(edited.expense.percentageEntries).toEqual(percentageEntries);
    expect(
      (await repositories.expenses.getById(created.expense.expenseId))
        ?.percentageEntries,
    ).toEqual(percentageEntries);
  });

  it("keeps legacy percentage history effective, blocks financial edits, and permits name/receipt changes", async () => {
    const participantIds = [SEEDED_USER_IDS.john, SEEDED_USER_IDS.raiyan];
    const unavailableSource = [
      { participantId: participantIds[0], basisPoints: basisPoints(5001) },
      { participantId: participantIds[1], basisPoints: basisPoints(4999) },
    ];
    const amount = positivePoisha(101);
    const legacy: Expense = {
      expenseId: expenseId("expense-legacy-application"),
      householdId: SEEDED_HOUSEHOLD_ID,
      creatorId: SEEDED_USER_IDS.raiyan,
      payerId: SEEDED_USER_IDS.raiyan,
      name: "Legacy percentage",
      amount,
      expenseDate: expenseDate("2026-08-12"),
      splitMethod: "percentage",
      allocations: allocatePercentageSplit(
        amount,
        participantIds,
        unavailableSource,
      ),
      payment: { method: "cash" },
      revision: 1,
      createdAt: isoInstant("2026-08-12T10:00:00.000Z"),
      updatedAt: isoInstant("2026-08-12T10:00:00.000Z"),
    };
    await db.add("expenses", toExpenseRecord(legacy));
    await db.add(
      "settlements",
      toSettlementRecord(
        confirmedSettlementRecord(
          "settlement-legacy-composition",
          isoInstant("2026-08-13T13:00:00.000Z"),
        ),
      ),
    );
    expect(
      (await application.expenses.getExpense(legacy.expenseId))
        .percentageSourceStatus,
    ).toBe("legacy-percentage-input-unavailable");
    expect(
      (await application.expenses.getExpense(legacy.expenseId))
        .financialEditability,
    ).toMatchObject({
      state: "locked",
      reasons: ["confirmed-settlement", "legacy-percentage"],
    });

    const renamed = await application.expenses.editExpense({
      expenseId: legacy.expenseId,
      expectedRevision: legacy.revision,
      name: "Legacy percentage renamed",
      amount: legacy.amount,
      expenseDate: legacy.expenseDate,
      splitMethod: legacy.splitMethod,
      allocations: legacy.allocations,
      payment: { kind: "preserve" },
    });
    expect(renamed.expense.name).toBe("Legacy percentage renamed");
    expect(renamed.expense.percentageEntries).toBeUndefined();

    await expect(
      application.expenses.editExpense({
        expenseId: legacy.expenseId,
        expectedRevision: renamed.expense.revision,
        name: renamed.expense.name,
        amount: positivePoisha(102),
        expenseDate: legacy.expenseDate,
        splitMethod: legacy.splitMethod,
        allocations: [
          { participantId: SEEDED_USER_IDS.john, share: poisha(51) },
          { participantId: SEEDED_USER_IDS.raiyan, share: poisha(51) },
        ],
        payment: { kind: "preserve" },
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });

    const png = deterministicSeedData().receiptBytes;
    const receipt = await application.receipts.addReceipt(legacy.expenseId, {
      originalFilename: "legacy.png",
      content: { bytes: png, mimeType: "image/png" },
    });
    expect(receipt.expenseId).toBe(legacy.expenseId);
    expect(
      (await repositories.expenses.getById(legacy.expenseId))?.allocations,
    ).toEqual(legacy.allocations);
  });

  it("keeps date-only expense values unchanged across application and persistence", async () => {
    const expense = await repositories.expenses.getById(expenseId("expense-groceries"));
    expect(expense?.expenseDate).toBe(expenseDate("2026-08-10"));
  });

  it("atomically stages receipt additions/removals and keeps receipts when the expense is soft-deleted", async () => {
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    const existing = (await repositories.receipts.listForExpense(
      original.expenseId,
    ))[0]!;
    const png = deterministicSeedData().receiptBytes;
    await application.expenses.editExpense({
      expenseId: original.expenseId,
      expectedRevision: original.revision,
      name: "Groceries with revised receipt",
      amount: original.amount,
      expenseDate: original.expenseDate,
      splitMethod: original.splitMethod,
      allocations: original.allocations,
      payment: { kind: "preserve" },
      newReceipts: [
        {
          originalFilename: "replacement.png",
          content: { bytes: png, mimeType: "image/png" },
        },
      ],
      removedReceiptIds: [existing.receiptId],
    });
    expect(await repositories.receipts.readContent(existing.receiptId)).toBeUndefined();
    expect(await repositories.receipts.getMetadata(existing.receiptId)).toMatchObject({ contentStatus: "user-deleted" });
    const activeReceipts = (await repositories.receipts.listForExpense(
      original.expenseId,
    )).filter((receipt) => receipt.contentStatus === "available");
    expect(activeReceipts).toHaveLength(1);
    expect(await repositories.receipts.readContent(activeReceipts[0]!.receiptId)).toEqual({
      bytes: png,
      mimeType: "image/png",
    });

    await application.expenses.deleteExpense(original.expenseId, original.revision + 1);
    expect(await repositories.receipts.readContent(activeReceipts[0]!.receiptId)).toEqual({
      bytes: png,
      mimeType: "image/png",
    });
    expect(await application.expenses.getExpense(original.expenseId)).toMatchObject({
      financialEditability: { state: "deleted" },
      permissions: {
        canEdit: false,
        canEditFinancialFields: false,
        canDelete: false,
      },
    });
  });

  it("does not let a House Leader bypass another creator's settled-history lock", async () => {
    await db.add(
      "settlements",
      toSettlementRecord(
        confirmedSettlementRecord(
          "settlement-leader-lock",
          isoInstant("2026-08-13T13:00:00.000Z"),
        ),
      ),
    );
    const original = (await repositories.expenses.getById(
      expenseId("expense-internet"),
    ))!;

    await expect(
      application.expenses.editExpense({
        expenseId: original.expenseId,
        expectedRevision: original.revision,
        name: original.name,
        amount: original.amount,
        expenseDate: expenseDate("2026-08-12"),
        splitMethod: original.splitMethod,
        allocations: original.allocations,
        payment: { kind: "preserve" },
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });
    await expect(
      application.expenses.deleteExpense(original.expenseId, original.revision),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });
    const leaderView = await application.expenses.getExpense(
      original.expenseId,
    );
    expect(leaderView.financialEditability.reasons).toContain(
      "confirmed-settlement",
    );
    expect(JSON.stringify(leaderView)).not.toMatch(
      /John Credit|powder-blue|card-john-credit/,
    );
  });

  it("keeps post-confirmation Expenses editable until a later confirmation", async () => {
    await db.add(
      "settlements",
      toSettlementRecord(
        confirmedSettlementRecord(
          "settlement-first-boundary",
          isoInstant("2026-08-13T12:00:00.000Z"),
        ),
      ),
    );
    const members = deterministicSeedData().memberships
      .filter((membership) => membership.status === "active")
      .map((membership) => membership.userId);
    const backdatedCommand = {
      commandId: commandId("command-backdated-create"),
      householdId: SEEDED_HOUSEHOLD_ID,
      name: "Backdated after confirmation",
      amount: positivePoisha(300),
      expenseDate: expenseDate("2026-08-01"),
      splitMethod: "equal",
      allocations: allocateEqualSplit(positivePoisha(300), members),
      payment: { method: "cash" },
    } as const;
    const challenge = await application.expenses.createExpense(backdatedCommand).catch((error: unknown) => error);
    expect(challenge).toBeInstanceOf(BackdatedExpenseConfirmationRequiredError);
    expect(await db.getAll("expenses")).toHaveLength(2);
    const created = await application.expenses.createExpense({
      ...backdatedCommand,
      backdatedConfirmationToken: (challenge as BackdatedExpenseConfirmationRequiredError).confirmationToken,
    });
    expect(created.expense.createdAt).toBe("2026-08-13T13:00:00.000Z");
    expect(created.financialEditability.state).toBe("editable");

    const editCommand = {
      commandId: commandId("command-backdated-edit"),
      expenseId: created.expense.expenseId,
      expectedRevision: created.expense.revision,
      name: created.expense.name,
      amount: positivePoisha(303),
      expenseDate: created.expense.expenseDate,
      splitMethod: "equal" as const,
      allocations: allocateEqualSplit(positivePoisha(303), members),
      payment: { kind: "preserve" as const },
    };
    const editChallenge = await application.expenses.editExpense(editCommand).catch((error: unknown) => error);
    expect(editChallenge).toBeInstanceOf(BackdatedExpenseConfirmationRequiredError);
    await expect(application.expenses.editExpense({
      ...editCommand,
      backdatedConfirmationToken: (editChallenge as BackdatedExpenseConfirmationRequiredError).confirmationToken,
    })).resolves.toMatchObject({ expense: { amount: 303 } });

    await db.add(
      "settlements",
      toSettlementRecord(
        confirmedSettlementRecord(
          "settlement-second-boundary",
          isoInstant("2026-08-13T14:00:00.000Z"),
        ),
      ),
    );
    const nowLocked = await application.expenses.getExpense(
      created.expense.expenseId,
    );
    expect(nowLocked.financialEditability).toMatchObject({
      state: "locked",
      reasons: ["confirmed-settlement"],
    });
  });

  it("freezes former-member financial history while allowing a name-only edit", async () => {
    await repositories.memberships.replace({
      householdId: SEEDED_HOUSEHOLD_ID,
      userId: SEEDED_USER_IDS.sarah,
      status: "former",
      role: "member",
    });
    await db.add(
      "settlements",
      toSettlementRecord(
        confirmedSettlementRecord(
          "settlement-former-composition",
          isoInstant("2026-08-13T13:00:00.000Z"),
        ),
      ),
    );
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    await expect(
      application.expenses.editExpense({
        expenseId: original.expenseId,
        expectedRevision: original.revision,
        name: "Groceries renamed",
        amount: original.amount,
        expenseDate: original.expenseDate,
        splitMethod: original.splitMethod,
        allocations: original.allocations,
        payment: { kind: "preserve" },
      }),
    ).resolves.toMatchObject({
      expense: { name: "Groceries renamed" },
      financialEditability: {
        state: "locked",
        reasons: ["confirmed-settlement", "former-member"],
      },
    });
    await expect(
      application.expenses.editExpense({
        expenseId: original.expenseId,
        expectedRevision: original.revision + 1,
        name: original.name,
        amount: positivePoisha(30_003),
        expenseDate: original.expenseDate,
        splitMethod: original.splitMethod,
        allocations: original.allocations.map((allocation) => ({
          ...allocation,
          share: poisha(allocation.share + 1),
        })),
        payment: { kind: "preserve" },
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });
    await expect(application.expenses.deleteExpense(original.expenseId, original.revision + 1)).rejects.toMatchObject({
      code: "EXPENSE_FINANCIAL_HISTORY_LOCKED",
    });
  });

  it("locks pre-existing Expense finance after confirmation without rewriting the Settlement", async () => {
    const confirmed = {
      settlementId: settlementId("settlement-confirmed-immutable"),
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
      createdAt: isoInstant("2026-08-12T12:00:00.000Z"),
      status: "confirmed" as const,
      resolvedAt: isoInstant("2026-08-13T13:00:00.000Z"),
    };
    await db.add("settlements", toSettlementRecord(confirmed));
    const before = await db.get("settlements", confirmed.settlementId);
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    const recommendationsBefore = await application.settlements.recommendations(
      SEEDED_HOUSEHOLD_ID,
    );
    await expect(application.expenses.editExpense({
        expenseId: original.expenseId,
        expectedRevision: original.revision,
        name: original.name,
        amount: positivePoisha(30_003),
        expenseDate: original.expenseDate,
        splitMethod: "equal",
        allocations: original.allocations.map((allocation) => ({
          ...allocation,
          share: poisha(10_001),
        })),
        payment: { kind: "preserve" },
      })).rejects.toMatchObject({
        code: "EXPENSE_FINANCIAL_HISTORY_LOCKED",
      });
    expect(await db.get("settlements", confirmed.settlementId)).toEqual(before);
    expect(
      await application.settlements.recommendations(SEEDED_HOUSEHOLD_ID),
    ).toEqual(recommendationsBefore);
    expect(await application.expenses.getExpense(original.expenseId)).toMatchObject({
      expense: { amount: original.amount },
      financialEditability: {
        state: "locked",
        reasons: ["confirmed-settlement"],
      },
      permissions: {
        canEdit: true,
        canEditFinancialFields: false,
        canDelete: false,
      },
    });
    const renamed = await application.expenses.editExpense({
      expenseId: original.expenseId,
      expectedRevision: original.revision,
      name: "Settled groceries renamed",
      amount: original.amount,
      expenseDate: original.expenseDate,
      splitMethod: original.splitMethod,
      allocations: original.allocations,
      payment: { kind: "preserve" },
    });
    expect(renamed.expense.name).toBe("Settled groceries renamed");

    const addedReceipt = await application.receipts.addReceipt(
      original.expenseId,
      {
        originalFilename: "settled-name-only.png",
        content: {
          bytes: deterministicSeedData().receiptBytes,
          mimeType: "image/png",
        },
      },
    );
    await application.receipts.deleteReceipt(addedReceipt.receiptId);
    expect(
      await repositories.receipts.getMetadata(addedReceipt.receiptId),
    ).toMatchObject({ contentStatus: "user-deleted" });
    await expect(
      application.expenses.deleteExpense(original.expenseId, renamed.expense.revision),
    ).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });
  });

  it("manages duplicate private Cards without a Household and derives ownership from session", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    const beforeAudits = await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID);
    const first = await application.cards.createMyCard({ name: "  Personal  ", type: "debit", colorId: "mint" });
    const second = await application.cards.createMyCard({ name: "Personal", type: "credit", colorId: "lavender" });
    expect((await application.cards.getMyCards()).cards).toEqual([first, second]);

    const updated = await application.cards.updateMyCard(first.cardId, {
      name: "Everyday",
      type: "credit",
      colorId: "soft-coral",
    });
    expect(updated).toMatchObject({ name: "Everyday", type: "credit", colorId: "soft-coral" });
    const preview = await application.cards.getMyCardRemovalPreview(second.cardId);
    expect(preview.expectedAction).toBe("delete");
    await expect(application.cards.deleteOrArchiveMyCard(second.cardId, "delete")).resolves.toBe("deleted");
    expect(await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID)).toEqual(beforeAudits);

    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    expect((await application.cards.getMyCards()).cards).not.toContainEqual(updated);
    await expect(application.cards.updateMyCard(first.cardId, {
      name: "Forbidden",
      type: "debit",
      colorId: "charcoal",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(application.cards.getMyCardRemovalPreview(first.cardId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps historical snapshots unchanged while future Expenses use authoritative edited Card data", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.john);
    const card = (await repositories.cards.listOwned(SEEDED_USER_IDS.john))[0]!;
    const historicalBefore = await repositories.expenses.getPrivateCardSnapshot(expenseId("expense-internet"), SEEDED_USER_IDS.john);
    await application.cards.updateMyCard(card.cardId, {
      name: "Main Card",
      type: "debit",
      colorId: "warm-sand",
    });
    expect(await repositories.expenses.getPrivateCardSnapshot(expenseId("expense-internet"), SEEDED_USER_IDS.john)).toEqual(historicalBefore);

    const created = await application.expenses.createExpense({
      householdId: SEEDED_HOUSEHOLD_ID,
      name: "Future Card Expense",
      amount: positivePoisha(500),
      expenseDate: expenseDate("2026-08-13"),
      splitMethod: "equal",
      allocations: [{ participantId: SEEDED_USER_IDS.john, share: poisha(500) }],
      payment: { method: "card", cardId: card.cardId },
    });
    expect(created.privateCardSnapshot).toMatchObject({ cardName: "Main Card", cardType: "debit", colorId: "warm-sand" });
    expect((await application.cards.listMySelectableCards())[0]).toMatchObject({ name: "Main Card", type: "debit", colorId: "warm-sand" });
  });

  it("creates a new Expense snapshot from Card state re-read inside the committing transaction", async () => {
    const card = (await repositories.cards.listOwned(SEEDED_USER_IDS.raiyan))[0]!;
    const persist = atomic.createExpense.bind(atomic);
    vi.spyOn(atomic, "createExpense").mockImplementationOnce(async (input) => {
      await repositories.cards.updateDetails({
        ...card,
        name: "Transaction-current Card",
        type: "credit",
        colorId: "charcoal",
        updatedAt: isoInstant("2026-08-13T12:59:59.000Z"),
      });
      return persist(input);
    });

    const created = await application.expenses.createExpense({
      householdId: SEEDED_HOUSEHOLD_ID,
      name: "Concurrent Card Expense",
      amount: positivePoisha(900),
      expenseDate: expenseDate("2026-08-13"),
      splitMethod: "equal",
      allocations: [{ participantId: SEEDED_USER_IDS.raiyan, share: poisha(900) }],
      payment: { method: "card", cardId: card.cardId },
    });
    expect(created.privateCardSnapshot).toMatchObject({
      cardId: card.cardId,
      cardName: "Transaction-current Card",
      cardType: "credit",
      colorId: "charcoal",
    });
  });

  it("rejects stale Delete consent and requires a refreshed Archive confirmation", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    const card = await application.cards.createMyCard({ name: "Temporary", type: "debit", colorId: "powder-blue" });
    expect((await application.cards.getMyCardRemovalPreview(card.cardId)).expectedAction).toBe("delete");
    await application.expenses.createExpense({
      householdId: SEEDED_HOUSEHOLD_ID,
      name: "New reference",
      amount: positivePoisha(700),
      expenseDate: expenseDate("2026-08-13"),
      splitMethod: "equal",
      allocations: [{ participantId: SEEDED_USER_IDS.raiyan, share: poisha(700) }],
      payment: { method: "card", cardId: card.cardId },
    });
    await expect(application.cards.deleteOrArchiveMyCard(card.cardId, "delete")).rejects.toMatchObject({ code: "CONFLICT" });
    const refreshed = await application.cards.getMyCardRemovalPreview(card.cardId);
    expect(refreshed.expectedAction).toBe("archive");
    await expect(application.cards.deleteOrArchiveMyCard(card.cardId, "archive")).resolves.toBe("archived");
    expect(await application.cards.listMySelectableCards()).not.toContainEqual(card);
    expect(await repositories.cards.getOwned(card.cardId, SEEDED_USER_IDS.raiyan)).toMatchObject({ archivedAt: expect.any(String) });
  });

  it("rejects stale Expense saves and deletes by revision while no-ops do not advance it", async () => {
    const original = (await repositories.expenses.getById(expenseId("expense-groceries")))!;
    const unchanged = await application.expenses.editExpense({ expenseId: original.expenseId, expectedRevision: original.revision, name: original.name, amount: original.amount, expenseDate: original.expenseDate, splitMethod: original.splitMethod, allocations: original.allocations, payment: { kind: "preserve" } });
    expect(unchanged.expense.revision).toBe(original.revision);
    const first = await application.expenses.editExpense({ expenseId: original.expenseId, expectedRevision: original.revision, name: "First editor", amount: original.amount, expenseDate: original.expenseDate, splitMethod: original.splitMethod, allocations: original.allocations, payment: { kind: "preserve" } });
    expect(first.expense.revision).toBe(original.revision + 1);
    await expect(application.expenses.editExpense({ expenseId: original.expenseId, expectedRevision: original.revision, name: "Stale editor", amount: original.amount, expenseDate: original.expenseDate, splitMethod: original.splitMethod, allocations: original.allocations, payment: { kind: "preserve" } })).rejects.toMatchObject({ code: "EXPENSE_VERSION_CONFLICT" });
    await expect(application.expenses.deleteExpense(original.expenseId, original.revision)).rejects.toMatchObject({ code: "EXPENSE_VERSION_CONFLICT" });
    expect((await repositories.expenses.getById(original.expenseId))?.name).toBe("First editor");
  });

  it("preserves legacy future records but blocks future creates and financial edits until repaired", async () => {
    const original = (await repositories.expenses.getById(expenseId("expense-groceries")))!;
    const future = { ...original, expenseId: expenseId("expense-legacy-future"), name: "Legacy future", expenseDate: expenseDate("2026-08-14") };
    await db.add("expenses", toExpenseRecord(future));
    const renamed = await application.expenses.editExpense({ expenseId: future.expenseId, expectedRevision: 1, name: "Legacy future renamed", amount: future.amount, expenseDate: future.expenseDate, splitMethod: future.splitMethod, allocations: future.allocations, payment: { kind: "preserve" } });
    expect(renamed.expense.expenseDate).toBe(future.expenseDate);
    await expect(application.expenses.editExpense({ expenseId: future.expenseId, expectedRevision: 2, name: renamed.expense.name, amount: positivePoisha(future.amount + 1), expenseDate: future.expenseDate, splitMethod: "amount", allocations: [{ participantId: future.creatorId, share: positivePoisha(future.amount + 1) }], payment: { kind: "preserve" } })).rejects.toMatchObject({ code: "EXPENSE_DATE_IN_FUTURE" });
    await expect(application.expenses.createExpense({ householdId: SEEDED_HOUSEHOLD_ID, name: "Tomorrow", amount: positivePoisha(1), expenseDate: expenseDate("2026-08-14"), splitMethod: "amount", allocations: [{ participantId: SEEDED_USER_IDS.raiyan, share: positivePoisha(1) }], payment: { method: "cash" } })).rejects.toMatchObject({ code: "EXPENSE_DATE_IN_FUTURE" });
  });

  it("projects private Receipts only to the creator or historical uploader and keeps management creator-only", async () => {
    const internet = (await repositories.expenses.getById(expenseId("expense-internet")))!;
    const metadata = { ...deterministicSeedData().receipt, receiptId: receiptId("receipt-historical-uploader"), expenseId: internet.expenseId, createdByUserId: SEEDED_USER_IDS.sarah, originalFilename: "private-bank.png" };
    await repositories.receipts.create(metadata, { bytes: deterministicSeedData().receiptBytes, mimeType: "image/png" });

    await session.switchIdentity(SEEDED_USER_IDS.sarah);
    expect(await application.receipts.listExpenseReceipts(internet.expenseId)).toEqual([expect.objectContaining({ visibility: "private", receiptId: metadata.receiptId, canRead: true, canRemove: false })]);
    await expect(application.receipts.deleteReceipt(metadata.receiptId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(application.receipts.addReceipt(internet.expenseId, { originalFilename: "forbidden.png", content: { bytes: deterministicSeedData().receiptBytes, mimeType: "image/png" } })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    const leaderProjection = await application.receipts.listExpenseReceipts(internet.expenseId);
    expect(leaderProjection).toEqual([{ visibility: "attachment", label: "Receipt attached" }]);
    expect(JSON.stringify(leaderProjection)).not.toMatch(/private-bank|receipt-historical-uploader|image\/png|sarah/);
    await expect(application.receipts.readReceipt(metadata.receiptId)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await session.switchIdentity(SEEDED_USER_IDS.john);
    expect(await application.receipts.listExpenseReceipts(internet.expenseId)).toEqual([expect.objectContaining({ visibility: "private", receiptId: metadata.receiptId, canRemove: true })]);
  });

  it("enforces three available Receipts and releases count after terminal deletion", async () => {
    const target = expenseId("expense-groceries");
    const png = deterministicSeedData().receiptBytes;
    const second = await application.receipts.addReceipt(target, { commandId: commandId("receipt-count-2"), originalFilename: "two.png", content: { bytes: png, mimeType: "image/png" } });
    await application.receipts.addReceipt(target, { commandId: commandId("receipt-count-3"), originalFilename: "three.png", content: { bytes: png, mimeType: "image/png" } });
    await expect(application.receipts.addReceipt(target, { commandId: commandId("receipt-count-4"), originalFilename: "four.png", content: { bytes: png, mimeType: "image/png" } })).rejects.toMatchObject({ code: "RECEIPT_COUNT_LIMIT_EXCEEDED" });
    await application.receipts.deleteReceipt(second.receiptId);
    await expect(application.receipts.addReceipt(target, { commandId: commandId("receipt-count-after-delete"), originalFilename: "replacement.png", content: { bytes: png, mimeType: "image/png" } })).resolves.toMatchObject({ contentStatus: "available" });
  });

  it("replays protected creates once, rejects changed intent, and scopes keys by actor", async () => {
    const expenseCommand = { householdId: SEEDED_HOUSEHOLD_ID, commandId: commandId("idem-expense"), name: "Idempotent tea", amount: positivePoisha(300), expenseDate: expenseDate("2026-08-13"), splitMethod: "amount" as const, allocations: [{ participantId: SEEDED_USER_IDS.raiyan, share: positivePoisha(300) }], payment: { method: "cash" as const } };
    const firstExpense = await application.expenses.createExpense(expenseCommand);
    const replayedExpense = await application.expenses.createExpense(expenseCommand);
    expect(replayedExpense.expense.expenseId).toBe(firstExpense.expense.expenseId);
    expect((await repositories.expenses.listHouseholdHistory(SEEDED_HOUSEHOLD_ID)).filter((item) => item.name === "Idempotent tea")).toHaveLength(1);
    await expect(application.expenses.createExpense({ ...expenseCommand, name: "Changed intent" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const firstCard = await application.cards.createMyCard({ commandId: commandId("idem-card"), name: "Retry card", type: "debit", colorId: "mint" });
    const replayedCard = await application.cards.createMyCard({ commandId: commandId("idem-card"), name: "Retry card", type: "debit", colorId: "mint" });
    expect(replayedCard.cardId).toBe(firstCard.cardId);
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    const otherActorCard = await application.cards.createMyCard({ commandId: commandId("idem-card"), name: "Retry card", type: "debit", colorId: "mint" });
    expect(otherActorCard.cardId).not.toBe(firstCard.cardId);
  });

  it("replays Receipt and Pending Settlement creation without duplicate durable records", async () => {
    const png = deterministicSeedData().receiptBytes;
    const receiptInput = { commandId: commandId("idem-receipt"), originalFilename: "retry.png", content: { bytes: png, mimeType: "image/png" as const } };
    const firstReceipt = await application.receipts.addReceipt(expenseId("expense-groceries"), receiptInput);
    const replayedReceipt = await application.receipts.addReceipt(expenseId("expense-groceries"), receiptInput);
    expect(replayedReceipt.receiptId).toBe(firstReceipt.receiptId);
    expect((await repositories.receipts.listForExpense(expenseId("expense-groceries"))).filter((item) => item.originalFilename === "retry.png")).toHaveLength(1);

    await session.switchIdentity(SEEDED_USER_IDS.john);
    await application.settlements.cancelSettlement(settlementId("settlement-john-raiyan"));
    const recommendation = (await application.settlements.recommendations(SEEDED_HOUSEHOLD_ID)).find((item) => item.senderId === SEEDED_USER_IDS.john)!;
    const firstSettlement = await application.settlements.createSettlement(recommendation, commandId("idem-settlement"));
    const replayedSettlement = await application.settlements.createSettlement(recommendation, commandId("idem-settlement"));
    expect(replayedSettlement).toBe(firstSettlement);
    expect((await repositories.settlements.listByHousehold(SEEDED_HOUSEHOLD_ID)).filter((item) => item.settlementId === firstSettlement)).toHaveLength(1);
  });
});
