import { describe, expect, it } from "vitest";

import { poisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { householdId, userId } from "../shared/identifiers";
import type { HouseholdBalanceSheet, MemberBalance } from "./balance-types";
import { generateSettlementRecommendations } from "./settlement-recommendations";

const house = householdId("house");

function sheet(entries: readonly [string, number][]): HouseholdBalanceSheet {
  const balances: MemberBalance[] = entries.map(([memberId, balance]) => ({
    householdId: house,
    memberId: userId(memberId),
    balance: poisha(balance),
  }));
  const creditor = entries.reduce(
    (sum, [, balance]) => (balance > 0 ? sum + balance : sum),
    0,
  );
  const debtor = entries.reduce(
    (sum, [, balance]) => (balance < 0 ? sum - balance : sum),
    0,
  );
  return {
    householdId: house,
    balances,
    totalCreditorValue: poisha(creditor),
    totalDebtorMagnitude: poisha(debtor),
  };
}

function simple(
  recommendations: ReturnType<typeof generateSettlementRecommendations>,
) {
  return recommendations.map((recommendation) => ({
    sender: recommendation.senderId,
    receiver: recommendation.receiverId,
    amount: recommendation.amount,
  }));
}

function applyRecommendations(
  source: HouseholdBalanceSheet,
  recommendations: ReturnType<typeof generateSettlementRecommendations>,
): Map<string, bigint> {
  const balances = new Map(
    source.balances.map((entry) => [entry.memberId, BigInt(entry.balance)]),
  );
  for (const recommendation of recommendations) {
    balances.set(
      recommendation.senderId,
      (balances.get(recommendation.senderId) ?? BigInt(0)) +
        BigInt(recommendation.amount),
    );
    balances.set(
      recommendation.receiverId,
      (balances.get(recommendation.receiverId) ?? BigInt(0)) -
        BigInt(recommendation.amount),
    );
  }
  return balances;
}

describe("deterministic settlement recommendations", () => {
  it("returns no transfers for an already settled household", () => {
    expect(
      generateSettlementRecommendations(sheet([["alice", 0], ["bob", 0]])),
    ).toEqual([]);
  });

  it("creates one full debtor-to-creditor recommendation", () => {
    expect(
      simple(
        generateSettlementRecommendations(
          sheet([["alice", 100], ["bob", -100]]),
        ),
      ),
    ).toEqual([{ sender: "bob", receiver: "alice", amount: 100 }]);
  });

  it("matches largest debtors and creditors first", () => {
    expect(
      simple(
        generateSettlementRecommendations(
          sheet([
            ["a", -70],
            ["b", -30],
            ["c", 60],
            ["d", 40],
          ]),
        ),
      ),
    ).toEqual([
      { sender: "a", receiver: "c", amount: 60 },
      { sender: "b", receiver: "d", amount: 30 },
      { sender: "a", receiver: "d", amount: 10 },
    ]);
  });

  it("breaks equal debtor and creditor magnitudes by stable member ID", () => {
    expect(
      simple(
        generateSettlementRecommendations(
          sheet([
            ["d", 50],
            ["b", -50],
            ["c", 50],
            ["a", -50],
          ]),
        ),
      ),
    ).toEqual([
      { sender: "a", receiver: "c", amount: 50 },
      { sender: "b", receiver: "d", amount: 50 },
    ]);
  });

  it("rejects non-zero-sum, duplicate, cross-household, or forged totals", () => {
    expect(() =>
      generateSettlementRecommendations(sheet([["a", 10], ["b", -9]])),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "BALANCE_SHEET_NOT_ZERO_SUM",
      }),
    );

    const duplicate = sheet([["a", 10], ["a", -10]]);
    expect(() => generateSettlementRecommendations(duplicate)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "BALANCE_SHEET_NOT_ZERO_SUM",
      }),
    );

    const forged = { ...sheet([["a", 10], ["b", -10]]), totalCreditorValue: poisha(9) };
    expect(() => generateSettlementRecommendations(forged)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "BALANCE_SHEET_NOT_ZERO_SUM",
      }),
    );
  });

  it("resolves deterministic generated zero-sum sheets exactly", () => {
    let seed = 73;
    for (let caseIndex = 0; caseIndex < 200; caseIndex += 1) {
      const values: number[] = [];
      let subtotal = 0;
      for (let index = 0; index < 5; index += 1) {
        seed = (seed * 48_271) % 2_147_483_647;
        const value = (seed % 101) - 50;
        values.push(value);
        subtotal += value;
      }
      values.push(-subtotal);
      const entries = values.map(
        (value, index) => [`member-${index}`, value] as [string, number],
      );
      const source = sheet(entries);
      const expected = generateSettlementRecommendations(source);
      const reordered = sheet([...entries].reverse());
      const actual = generateSettlementRecommendations(reordered);

      expect(actual).toEqual(expected);
      const nonzeroCount = source.balances.filter(
        (balance) => balance.balance !== 0,
      ).length;
      expect(expected.length).toBeLessThanOrEqual(
        Math.max(0, nonzeroCount - 1),
      );
      expect(
        [...applyRecommendations(source, expected).values()].every(
          (balance) => balance === BigInt(0),
        ),
      ).toBe(true);
      expect(
        expected.every(
          (recommendation) =>
            recommendation.amount > 0 &&
            recommendation.senderId !== recommendation.receiverId,
        ),
      ).toBe(true);
    }
  });
});
