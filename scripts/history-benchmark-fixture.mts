import { deterministicSeedData } from "../src/infrastructure/indexeddb/seed";
import { InMemoryTablesReader } from "../src/infrastructure/appwrite/reads/in-memory-tables-reader.helper";
import {
  openLocalDatabase,
  deleteLocalDatabase,
} from "../src/infrastructure/indexeddb/database";
import {
  toExpenseRecord,
  toExpenseCommentRecord,
  toHouseholdRecord,
  toMembershipRecord,
  toPrivateCardRecord,
  toProfileRecord,
  toSettlementRecord,
} from "../src/infrastructure/indexeddb/mappers";
import { expenseDate } from "../src/domain/dates/expense-date";
import {
  expenseCommentId,
  expenseId,
  cardId,
  settlementId,
} from "../src/domain/shared/identifiers";
import { isoInstant } from "../src/domain/shared/instant";
import { poisha, positivePoisha } from "../src/domain/money/poisha";
import {
  assertExpense,
  type Expense,
  type ExpenseComment,
  type ExpenseCardPrivateSnapshot,
} from "../src/domain/records/domain-records";
import type { SettlementRecord } from "../src/domain/settlements/settlement-types";

/** Synthetic records only. Nothing reads the user's database, env files, or provider. */
export function historyFixture(years: 1 | 5 | 10) {
  const seed = deterministicSeedData();
  const epoch = isoInstant("2016-08-01T12:00:00.000Z");
  const household = { ...seed.household, createdAt: epoch, updatedAt: epoch };
  const profiles = seed.profiles
    .map((profile) => ({ ...profile, createdAt: epoch, updatedAt: epoch }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
  const memberships = profiles.map((profile) => ({
    householdId: household.householdId,
    userId: profile.userId,
    status: "active" as const,
    role:
      profile.userId === seed.profiles[0].userId
        ? ("leader" as const)
        : ("member" as const),
  }));
  const expenses: Expense[] = [];
  const snapshots: ExpenseCardPrivateSnapshot[] = [];
  const comments: ExpenseComment[] = [];
  const settlements: SettlementRecord[] = [];
  for (let i = 0; i < years * 180; i += 1) {
    const instant = isoInstant(
      new Date(
        Date.UTC(2026, 8 - years * 12 + Math.floor(i / 15), (i % 15) + 1, 12),
      ).toISOString(),
    );
    const id = expenseId(`benchmark-expense-${String(i).padStart(6, "0")}`);
    const creator = profiles[i % profiles.length].userId;
    const amount = positivePoisha(30_000 + (i % 7) * 400);
    const card = i % 3 === 0;
    const expense: Expense = {
      expenseId: id,
      householdId: household.householdId,
      creatorId: creator,
      payerId: creator,
      name: `Synthetic Expense ${i}`,
      iconCategory: "others",
      amount,
      expenseDate: expenseDate(instant.slice(0, 10)),
      splitMethod: "equal",
      allocations: profiles.map((profile) => ({
        participantId: profile.userId,
        share: poisha(amount / 4),
      })),
      payment: card
        ? { method: "card", cardReference: `private:${id}` }
        : { method: "cash" },
      revision: 1,
      createdAt: instant,
      updatedAt: instant,
      ...(i % 20 === 0 ? { deletedAt: instant, deletedByUserId: creator } : {}),
    };
    assertExpense(expense);
    expenses.push(expense);
    if (card)
      snapshots.push({
        expenseId: id,
        ownerId: creator,
        cardId: cardId(`benchmark-card-${creator}`),
        cardName: "Synthetic private Card",
        cardType: "debit",
        colorId: "mint",
      });
    if (i % 10 === 0)
      comments.push({
        commentId: expenseCommentId(`benchmark-comment-${i}`),
        householdId: household.householdId,
        expenseId: id,
        authorUserId: creator,
        body: "Synthetic comment",
        createdAt: instant,
      });
    if (i % 15 === 0) {
      const recommendation = {
        householdId: household.householdId,
        senderId: profiles[0].userId,
        receiverId: profiles[1].userId,
        amount: positivePoisha(1000),
      };
      settlements.push({
        ...recommendation,
        settlementId: settlementId(`benchmark-settlement-${i}`),
        originatingRecommendation: recommendation,
        status: i % 30 === 0 ? "confirmed" : "cancelled",
        createdAt: instant,
        resolvedAt: instant,
      });
    }
  }
  return {
    household,
    profiles,
    memberships,
    expenses,
    snapshots,
    comments,
    settlements,
  };
}

export async function localHistory(fixture: ReturnType<typeof historyFixture>) {
  // A fresh process-local fake IndexedDB name; never the application's database.
  const name = `hft-history-benchmark-${process.pid}-${fixture.expenses.length}`;
  const db = await openLocalDatabase(name);
  try {
    const tx = db.transaction(
      [
        "households",
        "userProfiles",
        "memberships",
        "expenses",
        "expenseCardPrivateDetails",
        "expenseComments",
        "settlements",
      ],
      "readwrite",
    );
    await Promise.all([
      tx.objectStore("households").put(toHouseholdRecord(fixture.household)),
      ...fixture.profiles.map((value) =>
        tx.objectStore("userProfiles").put(toProfileRecord(value)),
      ),
      ...fixture.memberships.map((value) =>
        tx.objectStore("memberships").put(toMembershipRecord(value)),
      ),
      ...fixture.expenses.map((value) =>
        tx.objectStore("expenses").put(toExpenseRecord(value)),
      ),
      ...fixture.snapshots.map((value) =>
        tx
          .objectStore("expenseCardPrivateDetails")
          .put(toPrivateCardRecord(value)),
      ),
      ...fixture.comments.map((value) =>
        tx.objectStore("expenseComments").put(toExpenseCommentRecord(value)),
      ),
      ...fixture.settlements.map((value) =>
        tx.objectStore("settlements").put(toSettlementRecord(value)),
      ),
    ]);
    await tx.done;
  } catch (error) {
    db.close();
    await deleteLocalDatabase(name);
    throw error;
  }
  return {
    db,
    close: async () => {
      db.close();
      await deleteLocalDatabase(name);
    },
  };
}

export function providerHistory(fixture: ReturnType<typeof historyFixture>) {
  const reader = new InMemoryTablesReader();
  reader.seed("households", [
    {
      ...fixture.household,
      $id: fixture.household.householdId,
      version: 1,
      deletedAt: null,
      deletedByUserId: null,
    },
  ]);
  reader.seed(
    "profiles",
    fixture.profiles.map((profile) => ({
      $id: profile.userId,
      displayName: profile.displayName,
      version: 1,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    })),
  );
  reader.seed(
    "memberships",
    fixture.memberships.map((membership) => ({
      ...membership,
      $id: `membership-${membership.userId}`,
      version: 1,
      joinedAt: fixture.household.createdAt,
      leftAt: null,
      statusChangedAt: fixture.household.createdAt,
    })),
  );
  reader.seed(
    "expenses",
    fixture.expenses.map((expense) => ({
      $id: expense.expenseId,
      householdId: expense.householdId,
      expenseDate: expense.expenseDate,
      amountPoisha: String(expense.amount),
      payerId: expense.payerId,
      createdBy: expense.creatorId,
      splitMethod: expense.splitMethod,
      name: expense.name,
      iconCategory: expense.iconCategory,
      paymentMethod: expense.payment.method,
      paymentRefJson: JSON.stringify({ convention: "opaque" }),
      allocationsJson: JSON.stringify(
        expense.allocations.map((allocation) => ({
          participantId: allocation.participantId,
          sharePoisha: String(allocation.share),
        })),
      ),
      percentageEntriesJson: null,
      revision: expense.revision,
      createdAt: expense.createdAt,
      updatedAt: expense.updatedAt,
      deletedAt: expense.deletedAt ?? null,
      deletedByUserId: expense.deletedByUserId ?? null,
    })),
  );
  reader.seed(
    "expense_card_private_details",
    fixture.snapshots.map((snapshot) => ({
      $id: snapshot.expenseId,
      ownerId: snapshot.ownerId,
      cardId: snapshot.cardId,
      createdAt: fixture.household.createdAt,
      snapshotJson: JSON.stringify({
        cardName: snapshot.cardName,
        cardType: snapshot.cardType,
        colorId: snapshot.colorId,
      }),
    })),
  );
  reader.seed(
    "expense_comments",
    fixture.comments.map((comment) => ({ ...comment, $id: comment.commentId })),
  );
  reader.seed(
    "settlements",
    fixture.settlements.map((settlement) => ({
      $id: settlement.settlementId,
      householdId: settlement.householdId,
      senderId: settlement.senderId,
      receiverId: settlement.receiverId,
      amountPoisha: String(settlement.amount),
      originalAmountPoisha: String(settlement.originatingRecommendation.amount),
      status: settlement.status,
      pairKey: JSON.stringify([
        settlement.householdId,
        ...[settlement.senderId, settlement.receiverId].sort(),
      ]),
      recommendationDigest: "synthetic-benchmark",
      resolvedAt: settlement.resolvedAt ?? null,
      createdAt: settlement.createdAt,
    })),
  );
  return reader;
}
