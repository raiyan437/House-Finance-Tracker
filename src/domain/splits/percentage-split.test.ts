import { describe, expect, it } from "vitest";

import { basisPoints } from "../money/basis-points";
import { positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { userId, type UserId } from "../shared/identifiers";
import {
  allocatePercentageSplit,
  summarizePercentageSplitDraft,
} from "./percentage-split";
import type { PercentageSplitEntry } from "./split-types";

function ids(...values: string[]): UserId[] {
  return values.map(userId);
}

function entry(
  participantId: string,
  value: number,
): PercentageSplitEntry {
  return { participantId: userId(participantId), basisPoints: basisPoints(value) };
}

function shareRecord(
  allocations: ReturnType<typeof allocatePercentageSplit>,
): Record<string, number> {
  return Object.fromEntries(
    allocations.map((allocation) => [allocation.participantId, allocation.share]),
  );
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

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(
      (tail) => [value, ...tail],
    ),
  );
}

describe("percentage split", () => {
  it("provides provisional floor shares only for valid totals below 100%", () => {
    const summary = summarizePercentageSplitDraft(
      positivePoisha(101),
      ids("b", "a"),
      [entry("b", 2_500), entry("a", 3_333)],
    );

    expect(summary).toMatchObject({
      totalBasisPoints: 5_833,
      remainingBasisPoints: 4_167,
      isExact: false,
      provisional: true,
      allocatedTotal: 58,
      remainingAmount: 43,
    });
    expect(shareRecord(summary.allocations)).toEqual({ a: 33, b: 25 });
  });

  it("returns canonical largest-remainder shares when the draft reaches 100%", () => {
    const summary = summarizePercentageSplitDraft(
      positivePoisha(1),
      ids("b", "a"),
      [entry("b", 5_000), entry("a", 5_000)],
    );

    expect(summary).toMatchObject({
      totalBasisPoints: 10_000,
      remainingBasisPoints: 0,
      isExact: true,
      provisional: false,
      allocatedTotal: 1,
      remainingAmount: 0,
    });
    expect(shareRecord(summary.allocations)).toEqual({ a: 1, b: 0 });
  });

  it("rejects provisional totals above 100%", () => {
    expectCode(
      () =>
        summarizePercentageSplitDraft(positivePoisha(100), ids("a", "b"), [
          entry("a", 5_001),
          entry("b", 5_000),
        ]),
      "PERCENTAGE_TOTAL_NOT_100",
    );
  });

  it("allocates 100% to one participant", () => {
    expect(
      shareRecord(
        allocatePercentageSplit(positivePoisha(123), ids("a"), [
          entry("a", 10_000),
        ]),
      ),
    ).toEqual({ a: 123 });
  });

  it("uses stable ID ordering for equal largest remainders", () => {
    expect(
      shareRecord(
        allocatePercentageSplit(positivePoisha(1), ids("b", "a"), [
          entry("b", 5_000),
          entry("a", 5_000),
        ]),
      ),
    ).toEqual({ a: 1, b: 0 });
  });

  it("ranks distinct fractional remainders before participant IDs", () => {
    expect(
      shareRecord(
        allocatePercentageSplit(
          positivePoisha(10),
          ids("charlie", "alice", "bob"),
          [entry("alice", 5_001), entry("bob", 2_999), entry("charlie", 2_000)],
        ),
      ),
    ).toEqual({ alice: 5, bob: 3, charlie: 2 });
  });

  it("applies ID tie-breaking after the primary remainder ranking", () => {
    expect(
      shareRecord(
        allocatePercentageSplit(
          positivePoisha(2),
          ids("c", "a", "b"),
          [entry("c", 3_333), entry("a", 3_334), entry("b", 3_333)],
        ),
      ),
    ).toEqual({ a: 1, b: 1, c: 0 });
  });

  it("preserves participants with zero basis points and zero shares", () => {
    const allocations = allocatePercentageSplit(
      positivePoisha(1),
      ids("a", "b", "c"),
      [entry("a", 10_000), entry("b", 0), entry("c", 0)],
    );

    expect(allocations).toHaveLength(3);
    expect(shareRecord(allocations)).toEqual({ a: 1, b: 0, c: 0 });
  });

  it("is invariant to participant and entry input order", () => {
    const participants = ids("c", "a", "b");
    const entries = [entry("c", 3_333), entry("a", 3_334), entry("b", 3_333)];
    const expected = allocatePercentageSplit(
      positivePoisha(101),
      participants,
      entries,
    );

    for (const participantOrder of permutations(participants)) {
      for (const entryOrder of permutations(entries)) {
        expect(
          allocatePercentageSplit(
            positivePoisha(101),
            participantOrder,
            entryOrder,
          ),
        ).toEqual(expected);
      }
    }
  });

  it("uses bigint multiplication for the maximum safe expense", () => {
    const allocations = allocatePercentageSplit(
      positivePoisha(Number.MAX_SAFE_INTEGER),
      ids("a", "b"),
      [entry("a", 5_000), entry("b", 5_000)],
    );

    expect(shareRecord(allocations)).toEqual({
      a: 4_503_599_627_370_496,
      b: 4_503_599_627_370_495,
    });
  });

  it("rejects percentage totals below or above 10,000", () => {
    expectCode(
      () =>
        allocatePercentageSplit(positivePoisha(10), ids("a", "b"), [
          entry("a", 4_999),
          entry("b", 5_000),
        ]),
      "PERCENTAGE_TOTAL_NOT_100",
    );
    expectCode(
      () =>
        allocatePercentageSplit(positivePoisha(10), ids("a", "b"), [
          entry("a", 5_001),
          entry("b", 5_000),
        ]),
      "PERCENTAGE_TOTAL_NOT_100",
    );
  });

  it("rejects missing, unknown, and duplicate entries", () => {
    expectCode(
      () =>
        allocatePercentageSplit(positivePoisha(10), ids("a", "b"), [
          entry("a", 10_000),
        ]),
      "MISSING_SPLIT_ENTRY",
    );
    expectCode(
      () =>
        allocatePercentageSplit(positivePoisha(10), ids("a"), [
          entry("b", 10_000),
        ]),
      "UNKNOWN_SPLIT_PARTICIPANT",
    );
    expectCode(
      () =>
        allocatePercentageSplit(positivePoisha(10), ids("a"), [
          entry("a", 5_000),
          entry("a", 5_000),
        ]),
      "DUPLICATE_PARTICIPANT",
    );
  });

  it("maintains exact totals across deterministic amounts and valid percentages", () => {
    const percentageSets = [
      [10_000],
      [5_000, 5_000],
      [3_334, 3_333, 3_333],
      [1, 2, 3, 9_994],
      [0, 2_500, 2_500, 5_000],
    ];

    for (let amount = 1; amount <= 113; amount += 1) {
      for (const percentages of percentageSets) {
        const participantIds = percentages.map((_, index) =>
          userId(`member-${index}`),
        );
        const entries = percentages.map((value, index) =>
          entry(`member-${index}`, value),
        );
        const allocations = allocatePercentageSplit(
          positivePoisha(amount),
          participantIds.reverse(),
          entries.reverse(),
        );

        expect(allocations).toHaveLength(percentages.length);
        expect(
          allocations.reduce((sum, allocation) => sum + allocation.share, 0),
        ).toBe(amount);
      }
    }
  });
});
