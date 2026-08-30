import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IDBPDatabase } from "idb";
import {
  deleteLocalDatabase,
  openLocalDatabase,
} from "@/infrastructure/indexeddb/database";
import {
  deterministicSeedData,
  seedLocalDatabase,
  SEEDED_HOUSEHOLD_ID,
  SEEDED_USER_IDS,
} from "@/infrastructure/indexeddb/seed";
import { IndexedDbRepositories } from "@/infrastructure/indexeddb/repositories";
import { IndexedDbAtomicApplicationPersistence } from "@/infrastructure/indexeddb/atomic-persistence";
import { HouseFinanceApplication, type ApplicationValues } from "@/application/services/application-services";
import { localCalendarMonthFromInstant } from "@/application/analytics/calendar-month";
import type {
  ApplicationRepositories,
  AtomicApplicationPersistence,
  CurrentSession,
} from "@/application/repositories";
import { serializeWithBigInt } from "@/application/transport/json-bigint";
import type { Expense } from "@/domain/records/domain-records";
import type { IsoInstant } from "@/domain/shared/instant";
import { createAppwriteReadRepositories } from "./read-repositories.server";
import { InMemoryTablesReader } from "./in-memory-tables-reader.helper";
import { createInMemoryTablesDB } from "./in-memory-tables-reader.helper";
import { AppwriteCommandPersistence } from "../runtime/command-persistence.server";
import { commandId } from "@/domain/shared/identifiers";
import type { TablesDB } from "node-appwrite";

globalThis.Blob = NodeBlob as unknown as typeof Blob;

const ACTOR = SEEDED_USER_IDS.raiyan;
const SEED_INSTANT = "2026-08-13T00:00:00.000Z";

class FixedValues implements ApplicationValues {
  now(): IsoInstant { return SEED_INSTANT as IsoInstant; }
  nextId(): string { throw new Error("Read plane never generates IDs."); }
  nextHouseholdCodeCandidate(): string { return "000000001"; }
}

function fixedSession(userId: typeof ACTOR): CurrentSession {
  return {
    getCurrentUserId: async () => userId,
    subscribe: () => () => undefined,
  };
}

function placeholderAtomic(): AtomicApplicationPersistence {
  return new Proxy({} as AtomicApplicationPersistence, {
    get() {
      return () => {
        throw new Error("Writes are unavailable in this test.");
      };
    },
  });
}

/* ---------- domain record -> synthetic provider row builders ---------- */

function profileRow(profile: ReturnType<ApplicationRepositories["profiles"]["getByIds"]> extends never ? never : { userId: string; displayName: string; createdAt: string; updatedAt: string }): Record<string, unknown> {
  return { $id: profile.userId, displayName: profile.displayName, version: 1, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
}

function householdRow(household: { householdId: string; name: string; code: string; createdAt: string; updatedAt: string }): Record<string, unknown> {
  return { $id: household.householdId, name: household.name, code: household.code, version: 1, createdAt: household.createdAt, updatedAt: household.updatedAt, deletedAt: null, deletedByUserId: null };
}

function membershipRow(membership: { householdId: string; userId: string; role: string; status: string }, instant: string): Record<string, unknown> {
  const former = membership.status === "former";
  return { $id: `membership-${membership.householdId}-${membership.userId}`, householdId: membership.householdId, userId: membership.userId, role: membership.role, status: membership.status, joinedAt: instant, leftAt: former ? instant : null, statusChangedAt: instant, version: 1 };
}

function joinRequestRow(request: { joinRequestId: string; householdId: string; userId: string; status: string; createdAt: string; resolvedAt?: string; resolvedByUserId?: string }): Record<string, unknown> {
  return { $id: request.joinRequestId, householdId: request.householdId, userId: request.userId, status: request.status, createdAt: request.createdAt, resolvedAt: request.resolvedAt ?? null, resolvedByUserId: request.resolvedByUserId ?? null, requesterDisplayName: null };
}

function expenseRow(expense: Expense): Record<string, unknown> {
  return {
    $id: expense.expenseId,
    householdId: expense.householdId,
    expenseDate: expense.expenseDate,
    amountPoisha: String(expense.amount),
    payerId: expense.payerId,
    createdBy: expense.creatorId,
    splitMethod: expense.splitMethod,
    name: expense.name,
    paymentMethod: expense.payment.method,
    paymentRefJson: JSON.stringify({ convention: "opaque" }),
    allocationsJson: JSON.stringify(expense.allocations.map((allocation) => ({ participantId: allocation.participantId, sharePoisha: String(allocation.share) }))),
    percentageEntriesJson: expense.percentageEntries
      ? JSON.stringify(expense.percentageEntries.map((entry) => ({ participantId: entry.participantId, basisPoints: entry.basisPoints })))
      : null,
    revision: expense.revision,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    deletedAt: expense.deletedAt ?? null,
    deletedByUserId: expense.deletedByUserId ?? null,
  };
}

function snapshotRow(snapshot: { expenseId: string; ownerId: string; cardId: string; cardName: string; cardType: string; colorId: string; createdAt?: string }): Record<string, unknown> {
  return {
    $id: snapshot.expenseId,
    ownerId: snapshot.ownerId,
    cardId: snapshot.cardId,
    createdAt: snapshot.createdAt ?? SEED_INSTANT,
    snapshotJson: JSON.stringify({ cardName: snapshot.cardName, cardType: snapshot.cardType, colorId: snapshot.colorId }),
  };
}

function settlementRow(settlement: { settlementId: string; householdId: string; senderId: string; receiverId: string; amount: number; createdAt: string; status: string; resolvedAt?: string }, pairKey: string): Record<string, unknown> {
  return {
    $id: settlement.settlementId,
    householdId: settlement.householdId,
    senderId: settlement.senderId,
    receiverId: settlement.receiverId,
    amountPoisha: String(settlement.amount),
    originalAmountPoisha: String(settlement.amount),
    status: settlement.status,
    pairKey,
    recommendationDigest: "seed-digest",
    resolvedAt: settlement.resolvedAt ?? null,
    createdAt: settlement.createdAt,
  };
}

function cardRow(card: { cardId: string; ownerId: string; name: string; type: string; colorId: string; createdAt: string; updatedAt: string; archivedAt?: string }): Record<string, unknown> {
  return { $id: card.cardId, ownerId: card.ownerId, name: card.name, design: card.colorId, type: card.type, status: card.archivedAt ? "archived" : "active", archivedAt: card.archivedAt ?? null, version: 1, createdAt: card.createdAt, updatedAt: card.updatedAt };
}

function receiptRow(receipt: { receiptId: string; householdId: string; expenseId: string; createdByUserId: string; mimeType: string; originalFilename?: string; sizeBytes: number; createdAt: string; contentStatus: string }): Record<string, unknown> {
  return {
    $id: receipt.receiptId,
    uploaderId: receipt.createdByUserId,
    householdId: receipt.householdId,
    expenseId: receipt.expenseId,
    mimeType: receipt.mimeType,
    sizeBytes: receipt.sizeBytes,
    contentState: receipt.contentStatus,
    contentRemovedAt: null,
    contentRemovedByUserId: null,
    originalFilename: receipt.originalFilename ?? null,
    checksum: "seed-checksum",
    createdAt: receipt.createdAt,
    storageFileId: `storage-${receipt.receiptId}`,
  };
}

function auditRow(audit: { auditEventId: string; householdId: string; aggregateType: string; aggregateId: string; actorId: string; action: string; occurredAt: string; changedFields: readonly string[] }): Record<string, unknown> {
  return { $id: audit.auditEventId, householdId: audit.householdId, aggregateType: audit.aggregateType, aggregateId: audit.aggregateId, actorId: audit.actorId, action: audit.action, changedFieldsJson: JSON.stringify(audit.changedFields), occurredAt: audit.occurredAt };
}

/* ---------- the parity suite ---------- */

describe("R1 read plane parity: Appwrite projections equal local projections", () => {
  let connection: IDBPDatabase<never>;
  let reader: InMemoryTablesReader;

  beforeEach(async () => {
    connection = (await openLocalDatabase()) as unknown as IDBPDatabase<never>;
    await seedLocalDatabase(connection as never);
    const seed = deterministicSeedData();

    // Build the provider rows exactly as an R2 command writer would store them.
    reader = new InMemoryTablesReader();
    reader.seed("profiles", seed.profiles.map((profile) => ({ ...profileRow(profile), emailKey: undefined, displayEmail: undefined })));
    reader.seed("households", [householdRow(seed.household)]);
    reader.seed("memberships", seed.memberships.map((membership) => membershipRow(membership, SEED_INSTANT)));
    reader.seed("join_requests", [joinRequestRow(seed.joinRequest)]);
    reader.seed("expenses", seed.expenses.map((expense) => expenseRow(expense)));
    reader.seed("expense_card_private_details", [snapshotRow(seed.privateCard)]);
    reader.seed("cards", seed.cards.map((card) => cardRow(card)));
    reader.seed("receipt_metadata", [receiptRow(seed.receipt)]);
    reader.seed("audit_events", seed.audits.map((audit) => auditRow(audit)));
    reader.seed("command_outcomes", []);
    reader.seed("settlements", [
      settlementRow(
        { ...seed.settlement },
        (() => {
          const [first, second] = [String(seed.settlement.senderId), String(seed.settlement.receiverId)].sort();
          return JSON.stringify([SEEDED_HOUSEHOLD_ID, first, second]);
        })(),
      ),
    ]);
  });

  afterEach(async () => {
    await deleteLocalDatabase("hft-local");
  });

  function appwriteApplication(actorEmail: string, writable = false): HouseFinanceApplication {
    const repositories = createAppwriteReadRepositories(reader, ACTOR, actorEmail);
    return new HouseFinanceApplication({
      repositories: repositories as unknown as ApplicationRepositories,
      atomic: writable
        ? new AppwriteCommandPersistence(createInMemoryTablesDB(reader).tablesDB as unknown as TablesDB)
        : placeholderAtomic(),
      session: fixedSession(ACTOR),
      values: new FixedValues(),
    });
  }

  function localApplication(writable = false): { application: HouseFinanceApplication; repositories: IndexedDbRepositories } {
    const repositories = new IndexedDbRepositories(connection as never);
    const application = new HouseFinanceApplication({
      repositories,
      atomic: writable
        ? new IndexedDbAtomicApplicationPersistence(connection as never)
        : placeholderAtomic(),
      session: fixedSession(ACTOR),
      values: new FixedValues(),
    });
    return { application, repositories };
  }

  async function expectParity(local: Promise<unknown>, production: Promise<unknown>): Promise<void> {
    const [left, right] = await Promise.all([local, production]);
    expect(serializeWithBigInt(left)).toBe(serializeWithBigInt(right));
  }

  it("produces identical household access states", async () => {
    const local = localApplication();
    await expectParity(
      local.application.households.getCurrentAccessState(),
      appwriteApplication("raiyan@local.test").households.getCurrentAccessState(),
    );
  });

  it("produces numerically equivalent dashboards for the selected month", async () => {
    const local = localApplication();
    await expectParity(
      local.application.analytics.getDashboard(SEEDED_HOUSEHOLD_ID, "2026-08" as never),
      appwriteApplication("raiyan@local.test").analytics.getDashboard(SEEDED_HOUSEHOLD_ID, "2026-08" as never),
    );
  });

  it("produces numerically equivalent monthly reports including BigInt basis points", async () => {
    const local = localApplication();
    await expectParity(
      local.application.analytics.getMonthlyReport(SEEDED_HOUSEHOLD_ID, "2026-08" as never, localCalendarMonthFromInstant),
      appwriteApplication("raiyan@local.test").analytics.getMonthlyReport(SEEDED_HOUSEHOLD_ID, "2026-08" as never, localCalendarMonthFromInstant),
    );
  });

  it("produces identical settlement pages and pending previews", async () => {
    const local = localApplication();
    const production = appwriteApplication("raiyan@local.test");
    await expectParity(
      local.application.settlements.getSettlementPage(SEEDED_HOUSEHOLD_ID),
      production.settlements.getSettlementPage(SEEDED_HOUSEHOLD_ID),
    );
    await expectParity(
      local.application.settlements.getPendingSettlementActionPreview("settlement-john-raiyan" as never),
      production.settlements.getPendingSettlementActionPreview("settlement-john-raiyan" as never),
    );
  });

  it("produces identical expense views while keeping private card data owner-only", async () => {
    const local = localApplication();
    const production = appwriteApplication("raiyan@local.test");
    await expectParity(
      local.application.expenses.listHouseholdExpenses(SEEDED_HOUSEHOLD_ID),
      production.expenses.listHouseholdExpenses(SEEDED_HOUSEHOLD_ID),
    );
    // The card expense belongs to John; Raiyan must receive no private snapshot.
    const johnExpenseFromRaiyan = await production.expenses.getExpense("expense-internet" as never);
    expect(johnExpenseFromRaiyan.privateCardSnapshot).toBeUndefined();
  });

  it("produces identical card pages and receipt metadata projections with quota totals", async () => {
    const local = localApplication();
    const production = appwriteApplication("raiyan@local.test");
    await expectParity(local.application.cards.getMyCards(), production.cards.getMyCards());
    await expectParity(
      local.application.receipts.listExpenseReceipts("expense-groceries" as never),
      production.receipts.listExpenseReceipts("expense-groceries" as never),
    );
    await expect(local.application.receipts.getMyAvailableReceiptBytes()).resolves.toBe(
      await production.receipts.getMyAvailableReceiptBytes(),
    );
  });

  it("keeps local and Appwrite Profile rename projections and typed OCC failures equivalent", async () => {
    const local = localApplication(true).application;
    const production = appwriteApplication("raiyan@local.test", true);
    const [localBefore, productionBefore] = await Promise.all([
      local.profiles.getCurrentProfile(),
      production.profiles.getCurrentProfile(),
    ]);
    expect(localBefore.version).toBe(productionBefore.version);

    const [localUpdated, productionUpdated] = await Promise.all([
      local.profiles.updateCurrentProfile("  Raiyan Current  ", localBefore.version, commandId("profile-parity-local")),
      production.profiles.updateCurrentProfile("  Raiyan Current  ", productionBefore.version, commandId("profile-parity-appwrite")),
    ]);
    expect(productionUpdated).toEqual(localUpdated);
    await expectParity(
      local.analytics.getDashboard(SEEDED_HOUSEHOLD_ID, "2026-08" as never),
      production.analytics.getDashboard(SEEDED_HOUSEHOLD_ID, "2026-08" as never),
    );

    const errorCode = async (operation: Promise<unknown>): Promise<string | undefined> => {
      try {
        await operation;
        return undefined;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    const localErrorCode = await errorCode(
      local.profiles.updateCurrentProfile("Stale", localBefore.version, commandId("profile-stale-local")),
    );
    const productionErrorCode = await errorCode(
      production.profiles.updateCurrentProfile("Stale", productionBefore.version, commandId("profile-stale-appwrite")),
    );
    expect(localErrorCode).toBe("PROFILE_VERSION_CONFLICT");
    expect(productionErrorCode).toBe(localErrorCode);
  });
});
