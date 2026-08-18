import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expenseDate } from "@/domain/dates/expense-date";
import { positivePoisha } from "@/domain/money/poisha";
import { poisha } from "@/domain/money/poisha";
import { basisPoints } from "@/domain/money/basis-points";
import { expenseId, settlementId, userId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";
import { allocatePercentageSplit } from "@/domain/splits/percentage-split";
import type { Expense } from "@/domain/records/domain-records";
import { IndexedDbAtomicApplicationPersistence } from "@/infrastructure/indexeddb/atomic-persistence";
import { deleteLocalDatabase, openLocalDatabase } from "@/infrastructure/indexeddb/database";
import { LocalCurrentSession } from "@/infrastructure/indexeddb/development-session";
import { IndexedDbRepositories } from "@/infrastructure/indexeddb/repositories";
import { toExpenseRecord, toSettlementRecord } from "@/infrastructure/indexeddb/mappers";
import { SEEDED_HOUSEHOLD_ID, SEEDED_USER_IDS, seedLocalDatabase } from "@/infrastructure/indexeddb/seed";
import type { IDBPDatabase } from "idb";
import type { HouseFinanceDatabase } from "@/infrastructure/indexeddb/records";
import { HouseFinanceApplication, type ApplicationValues, type GeneratedIdKind } from "./application-services";

globalThis.Blob = NodeBlob as unknown as typeof Blob;

class FixedValues implements ApplicationValues {
  private counter = 0;
  now(): IsoInstant { return isoInstant("2026-08-13T13:00:00.000Z"); }
  nextId(kind: GeneratedIdKind): string { this.counter += 1; return `${kind}-test-${this.counter}`; }
  nextHouseholdCodeCandidate(): string { return "987654321"; }
}

describe("Phase 4 application services with IndexedDB", () => {
  let name: string;
  let db: IDBPDatabase<HouseFinanceDatabase>;
  let repositories: IndexedDbRepositories;
  let session: LocalCurrentSession;
  let application: HouseFinanceApplication;

  beforeEach(async () => {
    name = `application-services-${crypto.randomUUID()}`;
    db = await openLocalDatabase(name);
    await seedLocalDatabase(db);
    repositories = new IndexedDbRepositories(db);
    session = new LocalCurrentSession(db);
    application = new HouseFinanceApplication({ repositories, atomic: new IndexedDbAtomicApplicationPersistence(db), session, values: new FixedValues() });
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
    expect(ownerView.privateCardSnapshot).toMatchObject({ cardName: "John Credit", cardType: "credit", color: "blue" });
  });

  it("lets a leader preserve an opaque Card expense without loading private metadata", async () => {
    const getPrivate = vi.spyOn(repositories.expenses, "getPrivateCardSnapshot");
    const original = (await repositories.expenses.getById(expenseId("expense-internet")))!;
    const view = await application.expenses.editExpense({ expenseId: original.expenseId, name: "Updated Internet", amount: original.amount, expenseDate: original.expenseDate, splitMethod: original.splitMethod, allocations: original.allocations, payment: { kind: "preserve" } });
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
        name: original.name,
        amount: original.amount,
        expenseDate: original.expenseDate,
        splitMethod: original.splitMethod,
        allocations: original.allocations,
        payment: { kind: "card", cardId: card.cardId },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires explicit Card-to-Cash confirmation while retaining owner-private history", async () => {
    const original = (await repositories.expenses.getById(expenseId("expense-internet")))!;
    const command = { expenseId: original.expenseId, name: original.name, amount: original.amount, expenseDate: original.expenseDate, splitMethod: original.splitMethod, allocations: original.allocations } as const;
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
      await authoritativeCreate(input);
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
    expect(await application.cards.deleteCard((await repositories.cards.listOwned(SEEDED_USER_IDS.john))[0]!.cardId)).toBe("archived");
    expect(await repositories.cards.listOwned(SEEDED_USER_IDS.john)).toEqual([]);
    expect(await repositories.cards.listOwned(SEEDED_USER_IDS.john, true)).toHaveLength(1);
  });

  it("authorizes receipt reads and preserves deletion audit without binary payloads", async () => {
    const content = await application.receipts.readReceipt((await repositories.receipts.listForExpense(expenseId("expense-groceries")))[0]!.receiptId);
    expect([...content.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const metadata = (await repositories.receipts.listForExpense(expenseId("expense-groceries")))[0]!;
    await application.receipts.deleteReceipt(metadata.receiptId);
    expect(await repositories.receipts.readContent(metadata.receiptId)).toBeUndefined();
    const audits = await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID);
    expect(audits.at(-1)).toMatchObject({ aggregateType: "receipt", action: "deleted", changedFields: ["deletedAt"] });
    expect(JSON.stringify(audits)).not.toContain("137,80,78,71");
  });

  it("creates a validated expense and receipt atomically through application ports", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = await application.expenses.createExpense({ householdId: SEEDED_HOUSEHOLD_ID, name: "Tea", amount: positivePoisha(300), expenseDate: expenseDate("2026-08-13"), splitMethod: "equal", allocations: [{ participantId: SEEDED_USER_IDS.john, share: positivePoisha(100) }, { participantId: SEEDED_USER_IDS.raiyan, share: positivePoisha(100) }, { participantId: SEEDED_USER_IDS.sarah, share: positivePoisha(100) }], payment: { method: "cash" }, receipts: [{ originalFilename: "tea.png", content: { bytes: png, mimeType: "image/png" } }] });
    expect(view.expense.name).toBe("Tea");
    const storedReceipts = await repositories.receipts.listForExpense(view.expense.expenseId);
    expect(storedReceipts).toHaveLength(1);
    expect(await repositories.receipts.readContent(storedReceipts[0]!.receiptId)).toEqual({ bytes: png, mimeType: "image/png" });
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
      createdAt: isoInstant("2026-08-12T10:00:00.000Z"),
      updatedAt: isoInstant("2026-08-12T10:00:00.000Z"),
    };
    await repositories.expenses.create(legacy);
    expect(
      (await application.expenses.getExpense(legacy.expenseId))
        .percentageSourceStatus,
    ).toBe("legacy-percentage-input-unavailable");

    const renamed = await application.expenses.editExpense({
      expenseId: legacy.expenseId,
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
    ).rejects.toMatchObject({ code: "LEGACY_PERCENTAGE_INPUT_UNAVAILABLE" });

    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
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
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    await application.expenses.editExpense({
      expenseId: original.expenseId,
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
    expect(await repositories.receipts.getMetadata(existing.receiptId)).toHaveProperty("deletedAt");
    const activeReceipts = (await repositories.receipts.listForExpense(
      original.expenseId,
    )).filter((receipt) => !receipt.deletedAt);
    expect(activeReceipts).toHaveLength(1);
    expect(await repositories.receipts.readContent(activeReceipts[0]!.receiptId)).toEqual({
      bytes: png,
      mimeType: "image/png",
    });

    await application.expenses.deleteExpense(original.expenseId);
    expect(await repositories.receipts.readContent(activeReceipts[0]!.receiptId)).toEqual({
      bytes: png,
      mimeType: "image/png",
    });
    expect(await application.expenses.getExpense(original.expenseId)).toMatchObject({
      financialEditState: "deleted",
      permissions: { canEdit: false, canDelete: false },
    });
  });

  it("freezes former-member financial history while allowing a name-only edit", async () => {
    await repositories.memberships.replace({
      householdId: SEEDED_HOUSEHOLD_ID,
      userId: SEEDED_USER_IDS.sarah,
      status: "former",
      role: "member",
    });
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    await expect(
      application.expenses.editExpense({
        expenseId: original.expenseId,
        name: "Groceries renamed",
        amount: original.amount,
        expenseDate: original.expenseDate,
        splitMethod: original.splitMethod,
        allocations: original.allocations,
        payment: { kind: "preserve" },
      }),
    ).resolves.toMatchObject({
      expense: { name: "Groceries renamed" },
      financialEditState: "former-member-frozen",
    });
    await expect(
      application.expenses.editExpense({
        expenseId: original.expenseId,
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
    ).rejects.toMatchObject({ code: "FORMER_MEMBER_FINANCIAL_HISTORY_FROZEN" });
    await expect(application.expenses.deleteExpense(original.expenseId)).rejects.toMatchObject({
      code: "FORMER_MEMBER_FINANCIAL_HISTORY_FROZEN",
    });
  });

  it("never rewrites confirmed settlements when a permitted source expense changes", async () => {
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
      resolvedAt: isoInstant("2026-08-12T13:00:00.000Z"),
    };
    await db.add("settlements", toSettlementRecord(confirmed));
    const before = await db.get("settlements", confirmed.settlementId);
    const original = (await repositories.expenses.getById(
      expenseId("expense-groceries"),
    ))!;
    await application.expenses.editExpense({
      expenseId: original.expenseId,
      name: original.name,
      amount: positivePoisha(30_003),
      expenseDate: original.expenseDate,
      splitMethod: "equal",
      allocations: original.allocations.map((allocation) => ({
        ...allocation,
        share: poisha(10_001),
      })),
      payment: { kind: "preserve" },
    });
    expect(await db.get("settlements", confirmed.settlementId)).toEqual(before);
    expect(await application.settlements.recommendations(SEEDED_HOUSEHOLD_ID)).not.toEqual([]);
  });
});
