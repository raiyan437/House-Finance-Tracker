import { describe, expect, it } from "vitest";

import { positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import {
  householdId,
  settlementId,
  userId,
} from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import { assessSettlementStaleness } from "./settlement-staleness";
import type {
  SettlementRecommendation,
  SettlementRecord,
} from "./settlement-types";

const house = householdId("house");
const sender = userId("sender");
const receiver = userId("receiver");

function recommendation(
  senderId = sender,
  receiverId = receiver,
  amount = 100,
): SettlementRecommendation {
  return {
    householdId: house,
    senderId,
    receiverId,
    amount: positivePoisha(amount),
  };
}

const pending: SettlementRecord = {
  settlementId: settlementId("settlement"),
  householdId: house,
  senderId: sender,
  receiverId: receiver,
  amount: positivePoisha(100),
  originatingRecommendation: recommendation(),
  createdAt: isoInstant("2026-08-12T16:00:00.000Z"),
  status: "pending",
};

describe("Pending settlement staleness", () => {
  it.each([
    [[recommendation()], "current"],
    [[recommendation(sender, receiver, 60)], "amount-changed"],
    [[], "recommendation-absent"],
    [[recommendation(receiver, sender, 25)], "direction-reversed"],
  ] as const)("classifies current recommendations", (current, expected) => {
    expect(assessSettlementStaleness(pending, current)).toBe(expected);
  });

  it("ignores recommendations from another household", () => {
    expect(
      assessSettlementStaleness(pending, [
        { ...recommendation(), householdId: householdId("other") },
      ]),
    ).toBe("recommendation-absent");
  });

  it("rejects staleness assessment for terminal history", () => {
    expect(() =>
      assessSettlementStaleness(
        {
          ...pending,
          status: "confirmed",
          resolvedAt: isoInstant("2026-08-12T17:00:00.000Z"),
        },
        [recommendation()],
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_NOT_PENDING",
      }),
    );
  });
});
