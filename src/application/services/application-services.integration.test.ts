import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expenseDate } from "@/domain/dates/expense-date";
import { positivePoisha } from "@/domain/money/poisha";
import { expenseId, settlementId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";
import { IndexedDbAtomicApplicationPersistence } from "@/infrastructure/indexeddb/atomic-persistence";
import { deleteLocalDatabase, openLocalDatabase } from "@/infrastructure/indexeddb/database";
import { LocalCurrentSession } from "@/infrastructure/indexeddb/development-session";
import { IndexedDbRepositories } from "@/infrastructure/indexeddb/repositories";
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

  it("requires explicit private-reference detachment when a leader changes Card to Cash", async () => {
    const original = (await repositories.expenses.getById(expenseId("expense-internet")))!;
    const command = { expenseId: original.expenseId, name: original.name, amount: original.amount, expenseDate: original.expenseDate, splitMethod: original.splitMethod, allocations: original.allocations } as const;
    await expect(application.expenses.editExpense({ ...command, payment: { kind: "cash", confirmedPrivateReferenceDetachment: false } })).rejects.toMatchObject({ code: "PRIVATE_CARD_ACCESS_FORBIDDEN" });
    await application.expenses.editExpense({ ...command, payment: { kind: "cash", confirmedPrivateReferenceDetachment: true } });
    expect(await repositories.expenses.getPrivateCardSnapshot(original.expenseId, SEEDED_USER_IDS.john)).toBeUndefined();
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

  it("keeps date-only expense values unchanged across application and persistence", async () => {
    const expense = await repositories.expenses.getById(expenseId("expense-groceries"));
    expect(expense?.expenseDate).toBe(expenseDate("2026-08-10"));
  });
});
