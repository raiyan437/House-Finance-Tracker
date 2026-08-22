import { describe, expect, it } from "vitest";

import { expenseDate } from "../dates/expense-date";
import { basisPoints } from "../money/basis-points";
import { poisha, positivePoisha } from "../money/poisha";
import { allocatePercentageSplit } from "../splits/percentage-split";
import { householdId, settlementId, userId } from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import type { SettlementRecord, SettlementStatus } from "../settlements/settlement-types";
import type { ExpenseFinancialFingerprint } from "./expense-financial-fingerprint";
import {
  assertConfirmedSettlementFinancialChangeAllowed,
  isExpenseFinanciallyLocked,
  latestConfirmedSettlementAt,
} from "./confirmed-settlement-financial-lock";

const house = householdId("house-lock");
const otherHouse = householdId("house-other");
const payer = userId("payer");
const participant = userId("participant");
const createdAt = isoInstant("2026-08-20T10:00:00.000Z");

function settlement(
  status: SettlementStatus,
  resolvedAt?: string,
  targetHouseholdId = house,
): SettlementRecord {
  const senderId = userId("sender");
  const receiverId = userId("receiver");
  const amount = positivePoisha(100);
  return {
    settlementId: settlementId(
      `settlement-${status}-${resolvedAt ?? "pending"}-${targetHouseholdId}`,
    ),
    householdId: targetHouseholdId,
    senderId,
    receiverId,
    amount,
    originatingRecommendation: {
      householdId: targetHouseholdId,
      senderId,
      receiverId,
      amount,
    },
    createdAt: isoInstant("2026-08-19T10:00:00.000Z"),
    status,
    ...(resolvedAt ? { resolvedAt: isoInstant(resolvedAt) } : {}),
  };
}

function fingerprint(): ExpenseFinancialFingerprint {
  return {
    householdId: house,
    amount: positivePoisha(100),
    payerId: payer,
    splitMethod: "percentage",
    percentageEntries: [
      { participantId: payer, basisPoints: basisPoints(5000) },
      { participantId: participant, basisPoints: basisPoints(5000) },
    ],
    allocations: [
      { participantId: payer, share: poisha(50) },
      { participantId: participant, share: poisha(50) },
    ],
    expenseDate: expenseDate("2026-08-01"),
    payment: { method: "card", cardReference: "private:expense" },
    cardAssociationIdentity: "opaque-card-a",
    deleted: false,
  };
}

describe("confirmed Settlement Expense financial lock", () => {
  it("derives only the latest same-Household Confirmed boundary", () => {
    const history = [
      settlement("pending"),
      settlement("rejected", "2026-08-23T10:00:00.000Z"),
      settlement("cancelled", "2026-08-24T10:00:00.000Z"),
      settlement("confirmed", "2026-08-20T09:00:00.000Z"),
      settlement("confirmed", "2026-08-22T10:00:00.000Z"),
      settlement("confirmed", "2026-08-25T10:00:00.000Z", otherHouse),
    ];
    expect(latestConfirmedSettlementAt(house, history)).toBe(
      "2026-08-22T10:00:00.000Z",
    );
  });

  it.each(["pending", "rejected", "cancelled"] as const)(
    "%s Settlement history does not create a lock boundary",
    (status) => {
      const history = status === "pending"
        ? [settlement(status)]
        : [settlement(status, "2026-08-22T10:00:00.000Z")];
      expect(latestConfirmedSettlementAt(house, history)).toBeUndefined();
    },
  );

  it("locks before and exact-equality creation instants but not later creation", () => {
    expect(
      isExpenseFinanciallyLocked(
        isoInstant("2026-08-20T09:59:59.999Z"),
        createdAt,
      ),
    ).toBe(true);
    expect(isExpenseFinanciallyLocked(createdAt, createdAt)).toBe(true);
    expect(
      isExpenseFinanciallyLocked(
        isoInstant("2026-08-20T10:00:00.001Z"),
        createdAt,
      ),
    ).toBe(false);
    expect(isExpenseFinanciallyLocked(createdAt, undefined)).toBe(false);
  });

  it("blocks every financial fingerprint dimension while allowing an identical fingerprint", () => {
    const original = fingerprint();
    const boundary = isoInstant("2026-08-20T10:00:00.000Z");
    expect(() =>
      assertConfirmedSettlementFinancialChangeAllowed(
        original,
        { ...original, allocations: [...original.allocations].reverse() },
        createdAt,
        boundary,
      ),
    ).not.toThrow();

    const changedAmount = positivePoisha(101);
    const changedPercentages = [
      { participantId: payer, basisPoints: basisPoints(4900) },
      { participantId: participant, basisPoints: basisPoints(5100) },
    ] as const;
    const changed: readonly ExpenseFinancialFingerprint[] = [
      {
        ...original,
        amount: changedAmount,
        allocations: allocatePercentageSplit(
          changedAmount,
          [payer, participant],
          original.percentageEntries!,
        ),
      },
      { ...original, expenseDate: expenseDate("2026-08-02") },
      { ...original, payerId: participant },
      {
        ...original,
        allocations: [{ participantId: payer, share: poisha(100) }],
        percentageEntries: [
          { participantId: payer, basisPoints: basisPoints(10000) },
        ],
      },
      {
        ...original,
        splitMethod: "amount",
        percentageEntries: undefined,
      },
      {
        ...original,
        percentageEntries: changedPercentages,
        allocations: allocatePercentageSplit(
          original.amount,
          [payer, participant],
          changedPercentages,
        ),
      },
      {
        ...original,
        payment: { method: "cash" },
        cardAssociationIdentity: undefined,
      },
      { ...original, cardAssociationIdentity: "opaque-card-b" },
      { ...original, deleted: true },
    ];

    for (const proposed of changed) {
      expect(() =>
        assertConfirmedSettlementFinancialChangeAllowed(
          original,
          proposed,
          createdAt,
          boundary,
        ),
      ).toThrowError(
        expect.objectContaining({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" }),
      );
    }
  });

  it("does not use the backdated Expense Date for the boundary", () => {
    const boundary = isoInstant("2026-08-20T10:00:00.000Z");
    const createdAfter = isoInstant("2026-08-22T10:00:00.000Z");
    const original = fingerprint();
    const changedAmount = positivePoisha(101);
    expect(() =>
      assertConfirmedSettlementFinancialChangeAllowed(
        original,
        {
          ...original,
          amount: changedAmount,
          allocations: allocatePercentageSplit(
            changedAmount,
            [payer, participant],
            original.percentageEntries!,
          ),
        },
        createdAfter,
        boundary,
      ),
    ).not.toThrow();
  });
});
