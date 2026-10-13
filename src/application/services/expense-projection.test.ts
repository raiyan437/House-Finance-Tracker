import { describe, expect, it } from "vitest";
import {
  deterministicSeedData,
  SEEDED_USER_IDS,
} from "@/infrastructure/indexeddb/seed";
import { indexConfirmedSettlementHistory } from "@/domain/expenses/confirmed-settlement-history";
import { householdId, settlementId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { projectExpenseView } from "./expense-projection";

describe("indexed Expense projection parity", () => {
  it("preserves locks, deleted/former/legacy history, private Cards and backdated warnings", () => {
    const seed = deterministicSeedData();
    const confirmed: SettlementRecord = {
      ...seed.settlement,
      settlementId: settlementId("confirmed"),
      status: "confirmed",
      createdAt: isoInstant("2026-08-01T00:00:00.000Z"),
      resolvedAt: isoInstant("2026-08-12T18:00:00.000Z"),
    };
    const later: SettlementRecord = {
      ...confirmed,
      settlementId: settlementId("later"),
      resolvedAt: isoInstant("2026-08-14T00:00:00.000Z"),
    };
    const variants = seed.expenses.flatMap((expense) => [
      expense,
      {
        ...expense,
        deletedAt: expense.createdAt,
        deletedByUserId: expense.creatorId,
      },
      { ...expense, splitMethod: "percentage" as const },
    ]);
    const formerMemberships = seed.memberships.map((membership) =>
      membership.userId === SEEDED_USER_IDS.sarah
        ? { ...membership, status: "former" as const }
        : membership,
    );
    for (const rows of [
      [],
      [seed.settlement],
      [confirmed],
      [confirmed, later],
    ]) {
      const index = indexConfirmedSettlementHistory(
        seed.household.householdId,
        rows,
      );
      for (const memberships of [seed.memberships, formerMemberships]) {
        for (const expense of variants) {
          for (const viewer of [SEEDED_USER_IDS.raiyan, SEEDED_USER_IDS.john]) {
            const snapshot =
              viewer === expense.creatorId && expense.payment.method === "card"
                ? seed.privateCard
                : undefined;
            expect(
              projectExpenseView(
                expense,
                viewer,
                memberships,
                rows,
                snapshot,
                7,
                index,
              ),
            ).toEqual(
              projectExpenseView(
                expense,
                viewer,
                memberships,
                rows,
                snapshot,
                7,
              ),
            );
          }
        }
      }
    }
  });

  it("falls back to authoritative boundary scans for an unrelated household index", () => {
    const seed = deterministicSeedData();
    const index = indexConfirmedSettlementHistory(householdId("unrelated"), []);
    const expense = seed.expenses[0];
    expect(
      projectExpenseView(
        expense,
        expense.creatorId,
        seed.memberships,
        [seed.settlement],
        undefined,
        0,
        index,
      ),
    ).toEqual(
      projectExpenseView(expense, expense.creatorId, seed.memberships, [
        seed.settlement,
      ]),
    );
  });
});
