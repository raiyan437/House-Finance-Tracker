import { describe, expect, it } from "vitest";

import type { MembershipSnapshot } from "../membership/membership-types";
import { positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import {
  householdId,
  settlementId,
  userId,
} from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import type {
  SettlementRecommendation,
  SettlementRecord,
  SettlementStatus,
} from "./settlement-types";
import {
  createPendingSettlement,
  hasPendingSettlementForPair,
} from "./pending-settlement-policy";

const house = householdId("house");
const alice = userId("alice");
const bob = userId("bob");
const charlie = userId("charlie");
const createdAt = isoInstant("2026-08-12T16:00:00.000Z");
const memberships: readonly MembershipSnapshot[] = [
  { householdId: house, userId: alice, status: "active", role: "leader" },
  { householdId: house, userId: bob, status: "active", role: "member" },
  { householdId: house, userId: charlie, status: "former", role: "member" },
];

function recommendation(
  senderId = bob,
  receiverId = alice,
  amount = 100,
): SettlementRecommendation {
  return {
    householdId: house,
    senderId,
    receiverId,
    amount: positivePoisha(amount),
  };
}

function existing(
  status: SettlementStatus,
  senderId = bob,
  receiverId = alice,
): SettlementRecord {
  const origin = recommendation(senderId, receiverId);
  return {
    settlementId: settlementId(`existing-${status}`),
    householdId: house,
    senderId,
    receiverId,
    amount: origin.amount,
    originatingRecommendation: origin,
    createdAt,
    status,
    ...(status === "pending"
      ? {}
      : { resolvedAt: isoInstant("2026-08-12T17:00:00.000Z") }),
  };
}

function create(
  requested = recommendation(),
  current: readonly SettlementRecommendation[] = [requested],
  existingSettlements: readonly SettlementRecord[] = [],
  actorId = requested.senderId,
) {
  return createPendingSettlement({
    settlementId: settlementId("new-settlement"),
    householdId: house,
    actorId,
    requestedRecommendation: requested,
    createdAt,
    memberships,
    currentRecommendations: current,
    existingSettlements,
  });
}

describe("Pending settlement creation policy", () => {
  it("creates an immutable snapshot from an exact current full recommendation", () => {
    const pending = create();
    expect(pending).toMatchObject({
      senderId: bob,
      receiverId: alice,
      amount: 100,
      status: "pending",
      createdAt,
    });
    expect(pending.originatingRecommendation).toEqual(recommendation());
    expect(Object.isFrozen(pending)).toBe(true);
    expect(Object.isFrozen(pending.originatingRecommendation)).toBe(true);
  });

  it("requires the sender to create the claim", () => {
    expect(() => create(recommendation(), [recommendation()], [], alice)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_ACTOR_NOT_SENDER",
      }),
    );
  });

  it("requires both parties to be active household members", () => {
    const request = recommendation(charlie, alice);
    expect(() => create(request, [request])).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_MEMBER_INACTIVE",
      }),
    );
  });

  it("rejects arbitrary direction and non-full amounts", () => {
    expect(() => create(recommendation(), [])).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_NOT_RECOMMENDED",
      }),
    );
    expect(() =>
      create(recommendation(bob, alice, 40), [recommendation(bob, alice, 100)]),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_AMOUNT_MISMATCH",
      }),
    );
  });

  it("blocks a Pending settlement for the same unordered household pair", () => {
    expect(() => create(recommendation(), [recommendation()], [existing("pending")])).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "DUPLICATE_PENDING_SETTLEMENT",
      }),
    );

    const reversed = recommendation(alice, bob);
    expect(() =>
      create(reversed, [reversed], [existing("pending", bob, alice)]),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "DUPLICATE_PENDING_SETTLEMENT",
      }),
    );
  });

  it.each(["confirmed", "rejected", "cancelled"] as const)(
    "allows new creation after %s history",
    (status) => {
      expect(create(recommendation(), [recommendation()], [existing(status)]).status).toBe(
        "pending",
      );
    },
  );

  it("scopes duplicate detection to the household", () => {
    const otherHouse = householdId("other-house");
    const pendingElsewhere = {
      ...existing("pending"),
      householdId: otherHouse,
      originatingRecommendation: {
        ...recommendation(),
        householdId: otherHouse,
      },
    };
    expect(
      hasPendingSettlementForPair(house, alice, bob, [pendingElsewhere]),
    ).toBe(false);
    expect(create(recommendation(), [recommendation()], [pendingElsewhere]).status).toBe(
      "pending",
    );
  });
});
