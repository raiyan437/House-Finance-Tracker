import { describe, expect, it } from "vitest";

import { DomainError } from "../shared/domain-error";
import {
  basisPoints,
  parsePercentageToBasisPoints,
} from "./basis-points";

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected a domain error.");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe("basis points", () => {
  it.each([0, 1, 9_999, 10_000])("accepts %s", (value) => {
    expect(basisPoints(value)).toBe(value);
  });

  it.each([-1, 10_001, 0.1, Number.NaN, Number.MAX_SAFE_INTEGER])(
    "rejects %s",
    (value) => expectCode(() => basisPoints(value), "INVALID_BASIS_POINTS"),
  );

  it.each([
    ["0", 0],
    ["0.01", 1],
    ["1", 100],
    ["12.3", 1_230],
    ["33.33", 3_333],
    ["100", 10_000],
    ["100.00", 10_000],
  ])("parses %s as %s basis points", (text, expected) => {
    expect(parsePercentageToBasisPoints(text as string)).toBe(expected);
  });

  it.each(["", " ", ".5", "1.", "1.001", "-1", "1%", "1e2"])(
    "rejects malformed percentage %j",
    (value) =>
      expectCode(
        () => parsePercentageToBasisPoints(value),
        "INVALID_PERCENTAGE_TEXT",
      ),
  );

  it("rejects percentages over 100", () => {
    expectCode(
      () => parsePercentageToBasisPoints("100.01"),
      "INVALID_BASIS_POINTS",
    );
  });
});
