import { describe, expect, it } from "vitest";

import { positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { userId, type UserId } from "../shared/identifiers";
import { allocateEqualSplit } from "./equal-split";

function ids(...values: string[]): UserId[] {
  return values.map(userId);
}

function shares(
  allocations: ReturnType<typeof allocateEqualSplit>,
): Record<string, number> {
  return Object.fromEntries(
    allocations.map((allocation) => [allocation.participantId, allocation.share]),
  );
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(
      (tail) => [value, ...tail],
    ),
  );
}

describe("equal split", () => {
  it("allocates a single participant the full amount", () => {
    expect(
      shares(allocateEqualSplit(positivePoisha(501), ids("alice"))),
    ).toEqual({ alice: 501 });
  });

  it("allocates exact divisions", () => {
    expect(
      shares(
        allocateEqualSplit(
          positivePoisha(12),
          ids("charlie", "alice", "bob"),
        ),
      ),
    ).toEqual({ alice: 4, bob: 4, charlie: 4 });
  });

  it("distributes remainder poisha by canonical participant ID", () => {
    expect(
      shares(
        allocateEqualSplit(
          positivePoisha(10),
          ids("charlie", "alice", "bob"),
        ),
      ),
    ).toEqual({ alice: 4, bob: 3, charlie: 3 });
  });

  it("preserves every participant when exact allocation produces zero shares", () => {
    const allocations = allocateEqualSplit(
      positivePoisha(1),
      ids("charlie", "alice", "bob"),
    );

    expect(allocations).toHaveLength(3);
    expect(shares(allocations)).toEqual({ alice: 1, bob: 0, charlie: 0 });
  });

  it("is invariant to participant input order", () => {
    const participants = ids("charlie", "alice", "bob");
    const expected = allocateEqualSplit(positivePoisha(101), participants);

    for (const permutation of permutations(participants)) {
      expect(allocateEqualSplit(positivePoisha(101), permutation)).toEqual(
        expected,
      );
    }
  });

  it("allocates the maximum safe expense exactly", () => {
    const allocations = allocateEqualSplit(
      positivePoisha(Number.MAX_SAFE_INTEGER),
      ids("a", "b"),
    );
    const total = allocations.reduce(
      (sum, allocation) => sum + BigInt(allocation.share),
      BigInt(0),
    );

    expect(total).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(shares(allocations)).toEqual({
      a: 4_503_599_627_370_496,
      b: 4_503_599_627_370_495,
    });
  });

  it("rejects empty and duplicate participant collections", () => {
    expect(() => allocateEqualSplit(positivePoisha(1), [])).toThrowError(
      expect.objectContaining<Partial<DomainError>>({ code: "NO_PARTICIPANTS" }),
    );
    expect(() =>
      allocateEqualSplit(positivePoisha(1), ids("a", "a")),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "DUPLICATE_PARTICIPANT",
      }),
    );
  });

  it("maintains sum and membership over deterministic boundary combinations", () => {
    for (let amount = 1; amount <= 101; amount += 1) {
      for (let count = 1; count <= 12; count += 1) {
        const participantIds = Array.from({ length: count }, (_, index) =>
          userId(`member-${String(index).padStart(2, "0")}`),
        ).reverse();
        const allocations = allocateEqualSplit(
          positivePoisha(amount),
          participantIds,
        );

        expect(allocations).toHaveLength(count);
        expect(
          allocations.reduce((sum, allocation) => sum + allocation.share, 0),
        ).toBe(amount);
        expect(allocations.map((allocation) => allocation.participantId)).toEqual(
          [...participantIds].sort(),
        );
      }
    }
  });
});
