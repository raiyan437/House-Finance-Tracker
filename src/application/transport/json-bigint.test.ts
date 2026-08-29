import { describe, expect, it } from "vitest";
import { parseWithBigInt, serializeWithBigInt } from "./json-bigint";

describe("exact BigInt JSON transport", () => {
  it("round-trips BigInt intermediates and large safe-integer poisha", () => {
    interface Sample {
      readonly changeBasisPoints: bigint;
      readonly spent: number;
      readonly nested: Readonly<{ amount: number }>;
    }
    const sample = { changeBasisPoints: BigInt("-12345"), spent: 9_000_071_530_001, nested: { amount: 1 } };
    const restored = parseWithBigInt<Sample>(serializeWithBigInt(sample));
    expect(restored.changeBasisPoints).toBe(BigInt("-12345"));
    expect(restored.spent).toBe(9_000_071_530_001);
    expect(Number.isSafeInteger(restored.spent)).toBe(true);
  });

  it("never emits bare BigInt tokens for ordinary payloads", () => {
    expect(serializeWithBigInt({ plain: "text", count: 3 })).toBe(JSON.stringify({ plain: "text", count: 3 }));
  });
});
