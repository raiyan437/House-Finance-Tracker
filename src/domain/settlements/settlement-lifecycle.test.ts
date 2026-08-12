import { describe, expect, it } from "vitest";

import { positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import {
  householdId,
  settlementId,
  userId,
} from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import type { SettlementRecord } from "./settlement-types";
import {
  cancelSettlement,
  confirmSettlement,
  rejectSettlement,
} from "./settlement-lifecycle";

const house = householdId("house");
const sender = userId("sender");
const receiver = userId("receiver");
const other = userId("other");
const createdAt = isoInstant("2026-08-12T16:00:00.000Z");
const resolvedAt = isoInstant("2026-08-12T17:00:00.000Z");

function pending(amount = 100): SettlementRecord {
  const origin = Object.freeze({
    householdId: house,
    senderId: sender,
    receiverId: receiver,
    amount: positivePoisha(amount),
  });
  return Object.freeze({
    settlementId: settlementId("settlement"),
    householdId: house,
    senderId: sender,
    receiverId: receiver,
    amount: positivePoisha(amount),
    originatingRecommendation: origin,
    createdAt,
    status: "pending",
  });
}

describe("settlement lifecycle", () => {
  it("allows only the receiver to confirm and preserves the original exact amount", () => {
    const source = pending(137);
    const confirmed = confirmSettlement(source, receiver, resolvedAt);
    expect(confirmed).toMatchObject({
      status: "confirmed",
      amount: 137,
      resolvedAt,
    });
    expect(source.status).toBe("pending");
    expect(Object.isFrozen(confirmed)).toBe(true);
    expect(Object.isFrozen(confirmed.originatingRecommendation)).toBe(true);
    expect(() => confirmSettlement(pending(), sender, resolvedAt)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_ACTOR_NOT_RECEIVER",
      }),
    );
  });

  it("allows only the receiver to reject", () => {
    expect(rejectSettlement(pending(), receiver, resolvedAt).status).toBe(
      "rejected",
    );
    expect(() => rejectSettlement(pending(), other, resolvedAt)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_ACTOR_NOT_RECEIVER",
      }),
    );
  });

  it("allows only the sender to cancel", () => {
    expect(cancelSettlement(pending(), sender, resolvedAt).status).toBe(
      "cancelled",
    );
    expect(() => cancelSettlement(pending(), receiver, resolvedAt)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_ACTOR_NOT_SENDER",
      }),
    );
  });

  it.each(["confirmed", "rejected", "cancelled"] as const)(
    "prevents transition from terminal state %s",
    (status) => {
      const terminal = Object.freeze({ ...pending(), status, resolvedAt });
      const expectedCode =
        status === "confirmed"
          ? "CONFIRMED_SETTLEMENT_IMMUTABLE"
          : "INVALID_SETTLEMENT_TRANSITION";
      expect(() => confirmSettlement(terminal, receiver, resolvedAt)).toThrowError(
        expect.objectContaining<Partial<DomainError>>({ code: expectedCode }),
      );
      expect(() => rejectSettlement(terminal, receiver, resolvedAt)).toThrowError(
        expect.objectContaining<Partial<DomainError>>({ code: expectedCode }),
      );
      expect(() => cancelSettlement(terminal, sender, resolvedAt)).toThrowError(
        expect.objectContaining<Partial<DomainError>>({ code: expectedCode }),
      );
    },
  );
});
