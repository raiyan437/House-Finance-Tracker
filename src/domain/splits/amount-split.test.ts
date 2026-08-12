import { describe, expect, it } from "vitest";

import { poisha, positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { userId, type UserId } from "../shared/identifiers";
import { allocateAmountSplit, summarizeAmountSplit } from "./amount-split";
import type { AmountSplitEntry } from "./split-types";

function ids(...values: string[]): UserId[] {
  return values.map(userId);
}

function entry(participantId: string, amount: number): AmountSplitEntry {
  return { participantId: userId(participantId), amount: poisha(amount) };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected a domain error.");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe("amount split", () => {
  it("finalizes an exact split in canonical participant order", () => {
    expect(
      allocateAmountSplit(positivePoisha(100), ids("b", "a"), [
        entry("b", 40),
        entry("a", 60),
      ]),
    ).toEqual([
      { participantId: "a", share: 60 },
      { participantId: "b", share: 40 },
    ]);
  });

  it("preserves selected zero-share participants", () => {
    expect(
      allocateAmountSplit(positivePoisha(1), ids("a", "b", "c"), [
        entry("a", 1),
        entry("b", 0),
        entry("c", 0),
      ]),
    ).toHaveLength(3);
  });

  it("summarizes under- and over-allocation with signed remaining poisha", () => {
    expect(
      summarizeAmountSplit(positivePoisha(100), ids("a", "b"), [
        entry("a", 30),
        entry("b", 40),
      ]),
    ).toMatchObject({ allocatedTotal: 70, remaining: 30, isExact: false });

    expect(
      summarizeAmountSplit(positivePoisha(100), ids("a", "b"), [
        entry("a", 80),
        entry("b", 40),
      ]),
    ).toMatchObject({ allocatedTotal: 120, remaining: -20, isExact: false });
  });

  it("rejects totals that do not exactly match", () => {
    expectCode(
      () =>
        allocateAmountSplit(positivePoisha(100), ids("a", "b"), [
          entry("a", 30),
          entry("b", 40),
        ]),
      "AMOUNT_SPLIT_TOTAL_MISMATCH",
    );
  });

  it("rejects negative, missing, unknown, and duplicate entries", () => {
    expectCode(
      () =>
        allocateAmountSplit(positivePoisha(100), ids("a"), [entry("a", -1)]),
      "NEGATIVE_SPLIT_SHARE",
    );
    expectCode(
      () => allocateAmountSplit(positivePoisha(100), ids("a", "b"), [entry("a", 100)]),
      "MISSING_SPLIT_ENTRY",
    );
    expectCode(
      () => allocateAmountSplit(positivePoisha(100), ids("a"), [entry("b", 100)]),
      "UNKNOWN_SPLIT_PARTICIPANT",
    );
    expectCode(
      () =>
        allocateAmountSplit(positivePoisha(100), ids("a"), [
          entry("a", 50),
          entry("a", 50),
        ]),
      "DUPLICATE_PARTICIPANT",
    );
  });

  it("detects accumulation outside the safe poisha range", () => {
    expectCode(
      () =>
        summarizeAmountSplit(
          positivePoisha(Number.MAX_SAFE_INTEGER),
          ids("a", "b"),
          [entry("a", Number.MAX_SAFE_INTEGER), entry("b", 1)],
        ),
      "MONEY_OVERFLOW",
    );
  });
});
