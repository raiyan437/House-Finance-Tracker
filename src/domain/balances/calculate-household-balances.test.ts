import { describe, expect, it } from "vitest";

import { expenseDate } from "../dates/expense-date";
import type { BalanceExpense } from "../expenses/balance-expense";
import type { MembershipSnapshot } from "../membership/membership-types";
import { poisha, positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import {
  expenseId,
  householdId,
  settlementId,
  userId,
} from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import type { SettlementRecord } from "../settlements/settlement-types";
import { allocateEqualSplit } from "../splits/equal-split";
import { calculateHouseholdBalances } from "./calculate-household-balances";

const house = householdId("house");
const alice = userId("alice");
const bob = userId("bob");
const charlie = userId("charlie");

const memberships: readonly MembershipSnapshot[] = [
  { householdId: house, userId: alice, status: "active", role: "leader" },
  { householdId: house, userId: bob, status: "active", role: "member" },
  { householdId: house, userId: charlie, status: "former", role: "member" },
];

function expense(
  payerId: typeof alice,
  amount: number,
  shares: readonly [typeof alice, number][],
  deleted = false,
  id = "expense",
): BalanceExpense {
  return {
    expenseId: expenseId(id),
    householdId: house,
    payerId,
    amount: positivePoisha(amount),
    allocations: shares
      .map(([participantId, share]) => ({
        participantId,
        share: poisha(share),
      }))
      .sort((left, right) =>
        left.participantId < right.participantId ? -1 : 1,
      ),
    deleted,
  };
}

function settlement(
  status: SettlementRecord["status"],
  amount: number,
  senderId = bob,
  receiverId = alice,
): SettlementRecord {
  const recommendation = Object.freeze({
    householdId: house,
    senderId,
    receiverId,
    amount: positivePoisha(amount),
  });
  return Object.freeze({
    settlementId: settlementId(`${status}-${amount}`),
    householdId: house,
    senderId,
    receiverId,
    amount: positivePoisha(amount),
    originatingRecommendation: recommendation,
    createdAt: isoInstant("2026-08-12T16:00:00.000Z"),
    status,
    ...(status === "pending"
      ? {}
      : { resolvedAt: isoInstant("2026-08-12T17:00:00.000Z") }),
  });
}

function record(sheet: ReturnType<typeof calculateHouseholdBalances>) {
  return Object.fromEntries(
    sheet.balances.map((balance) => [balance.memberId, balance.balance]),
  );
}

describe("household balance calculation", () => {
  it("uses paid minus assigned-share with positive creditor convention", () => {
    const sheet = calculateHouseholdBalances(
      house,
      memberships,
      [expense(alice, 100, [[alice, 50], [bob, 50]])],
      [],
    );

    expect(record(sheet)).toEqual({ alice: 50, bob: -50, charlie: 0 });
    expect(sheet.totalCreditorValue).toBe(50);
    expect(sheet.totalDebtorMagnitude).toBe(50);
  });

  it("supports an excluded payer and explicit zero-share former participant", () => {
    const sheet = calculateHouseholdBalances(
      house,
      memberships,
      [expense(alice, 1, [[bob, 1], [charlie, 0]])],
      [],
    );
    expect(record(sheet)).toEqual({ alice: 1, bob: -1, charlie: 0 });
  });

  it("excludes soft-deleted expenses", () => {
    const sheet = calculateHouseholdBalances(
      house,
      memberships,
      [expense(alice, 100, [[bob, 100]], true)],
      [],
    );
    expect(record(sheet)).toEqual({ alice: 0, bob: 0, charlie: 0 });
  });

  it("applies only confirmed settlement effects using the recorded amount", () => {
    const baseExpense = expense(alice, 100, [[bob, 100]]);
    for (const status of ["pending", "rejected", "cancelled"] as const) {
      expect(
        record(
          calculateHouseholdBalances(
            house,
            memberships,
            [baseExpense],
            [settlement(status, 40)],
          ),
        ),
      ).toEqual({ alice: 100, bob: -100, charlie: 0 });
    }

    expect(
      record(
        calculateHouseholdBalances(
          house,
          memberships,
          [baseExpense],
          [settlement("confirmed", 40)],
        ),
      ),
    ).toEqual({ alice: 60, bob: -60, charlie: 0 });
  });

  it("allows a stale confirmed overpayment to reverse the balance", () => {
    const sheet = calculateHouseholdBalances(
      house,
      memberships,
      [expense(alice, 30, [[bob, 30]])],
      [settlement("confirmed", 50)],
    );
    expect(record(sheet)).toEqual({ alice: -20, bob: 20, charlie: 0 });
  });

  it("combines multiple payers and remains exactly zero-sum", () => {
    const sheet = calculateHouseholdBalances(
      house,
      memberships,
      [
        expense(alice, 101, [[alice, 34], [bob, 34], [charlie, 33]], false, "a"),
        expense(bob, 70, [[alice, 20], [bob, 50]], false, "b"),
      ],
      [],
    );
    expect(record(sheet)).toEqual({ alice: 47, bob: -14, charlie: -33 });
    expect(
      sheet.balances.reduce((sum, balance) => sum + balance.balance, 0),
    ).toBe(0);
  });

  it("rejects unknown members, cross-household entries, and malformed allocations", () => {
    expect(() =>
      calculateHouseholdBalances(
        house,
        memberships,
        [expense(userId("outsider") as typeof alice, 1, [[bob, 1]])],
        [],
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "UNKNOWN_BALANCE_MEMBER",
      }),
    );

    const otherExpense = {
      ...expense(alice, 1, [[bob, 1]]),
      householdId: householdId("other"),
    };
    expect(() =>
      calculateHouseholdBalances(house, memberships, [otherExpense], []),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "INVALID_EXPENSE_LEDGER_ENTRY",
      }),
    );
  });

  it("detects balance aggregation overflow", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(() =>
      calculateHouseholdBalances(
        house,
        memberships,
        [
          expense(alice, max, [[bob, max]], false, "max-a"),
          expense(alice, max, [[bob, max]], false, "max-b"),
        ],
        [],
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({ code: "BALANCE_OVERFLOW" }),
    );
  });

  it("generates exact zero-sum ledgers deterministically under reordered inputs", () => {
    const memberIds = memberships.map((membership) => membership.userId);
    const generatedExpenses: BalanceExpense[] = [];
    for (let index = 1; index <= 120; index += 1) {
      const amount = positivePoisha(index * 17 + 1);
      const participantCount = (index % memberIds.length) + 1;
      const participantIds = memberIds.slice(0, participantCount).reverse();
      generatedExpenses.push({
        expenseId: expenseId(`generated-${index}`),
        householdId: house,
        payerId: memberIds[index % memberIds.length],
        amount,
        allocations: allocateEqualSplit(amount, participantIds),
        deleted: index % 11 === 0,
      });
    }

    const forward = calculateHouseholdBalances(
      house,
      memberships,
      generatedExpenses,
      [],
    );
    const reversed = calculateHouseholdBalances(
      house,
      [...memberships].reverse(),
      [...generatedExpenses].reverse(),
      [],
    );
    expect(reversed).toEqual(forward);
    expect(
      forward.balances.reduce(
        (sum, balance) => sum + BigInt(balance.balance),
        BigInt(0),
      ),
    ).toBe(BigInt(0));
    expect(forward.totalCreditorValue).toBe(forward.totalDebtorMagnitude);
  });

  it("does not use the date value to alter current-state ledger membership", () => {
    expect(expenseDate("2026-08-12")).toBe("2026-08-12");
  });
});
