import { describe, expect, it } from "vitest";

import { positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import {
  householdId,
  settlementId,
  userId,
} from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import { assertSettlementRecord } from "./settlement-invariants";
import type { SettlementRecord } from "./settlement-types";

const house = householdId("house");
const sender = userId("sender");
const receiver = userId("receiver");

function record(): SettlementRecord {
  return {
    settlementId: settlementId("settlement"),
    householdId: house,
    senderId: sender,
    receiverId: receiver,
    amount: positivePoisha(100),
    originatingRecommendation: {
      householdId: house,
      senderId: sender,
      receiverId: receiver,
      amount: positivePoisha(100),
    },
    createdAt: isoInstant("2026-08-12T16:00:00.000Z"),
    status: "pending",
  };
}

describe("settlement record invariants", () => {
  it("accepts a coherent Pending snapshot", () => {
    expect(() => assertSettlementRecord(record())).not.toThrow();
  });

  it("rejects rewritten parties or original amount", () => {
    expect(() =>
      assertSettlementRecord({
        ...record(),
        receiverId: userId("rewritten-receiver"),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "INVALID_SETTLEMENT_PARTIES",
      }),
    );
    expect(() =>
      assertSettlementRecord({ ...record(), amount: positivePoisha(99) }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "SETTLEMENT_AMOUNT_MISMATCH",
      }),
    );
  });

  it("requires terminal resolution timestamps and forbids them on Pending", () => {
    expect(() =>
      assertSettlementRecord({
        ...record(),
        resolvedAt: isoInstant("2026-08-12T17:00:00.000Z"),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "INVALID_SETTLEMENT_TRANSITION",
      }),
    );
    expect(() =>
      assertSettlementRecord({ ...record(), status: "confirmed" }),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "INVALID_SETTLEMENT_TRANSITION",
      }),
    );
  });
});
