import { describe, expect, it } from "vitest";

import { DomainError } from "../shared/domain-error";
import {
  formatCanonicalBdt,
  parseBdtToPoisha,
  poisha,
  poishaFromBigInt,
  positivePoisha,
  sumPoisha,
} from "./poisha";

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected a domain error.");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe("poisha", () => {
  it.each([0, 1, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])(
    "accepts safe integer %s",
    (value) => expect(poisha(value)).toBe(value),
  );

  it.each([
    0.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects non-safe value %s", (value) =>
    expectCode(() => poisha(value), "INVALID_POISHA"),
  );

  it("requires positive expense money", () => {
    expect(positivePoisha(1)).toBe(1);
    expectCode(() => positivePoisha(0), "NON_POSITIVE_EXPENSE_AMOUNT");
    expectCode(() => positivePoisha(-1), "NON_POSITIVE_EXPENSE_AMOUNT");
  });

  it.each([
    ["0", 0],
    ["0.01", 1],
    ["1", 100],
    ["1.2", 120],
    ["1.20", 120],
    ["0001.20", 120],
    ["123456.78", 12_345_678],
  ])("parses %s exactly", (text, expected) => {
    expect(parseBdtToPoisha(text as string)).toBe(expected);
  });

  it.each([
    "",
    " ",
    " 1",
    "1 ",
    ".50",
    "1.",
    "1.001",
    "1,000",
    "৳1",
    "-1",
    "+1",
    "1e3",
    "NaN",
    "Infinity",
  ])("rejects non-canonical money text %j", (value) =>
    expectCode(() => parseBdtToPoisha(value), "INVALID_MONEY_TEXT"),
  );

  it("rejects parsed and calculated values outside the safe range", () => {
    expectCode(
      () => parseBdtToPoisha("90071992547409.92"),
      "MONEY_OVERFLOW",
    );
    expectCode(
      () => poishaFromBigInt(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)),
      "MONEY_OVERFLOW",
    );
    expectCode(
      () => sumPoisha([poisha(Number.MAX_SAFE_INTEGER), poisha(1)]),
      "MONEY_OVERFLOW",
    );
  });

  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [100, "1.00"],
    [120, "1.20"],
    [-1, "-0.01"],
    [12_345_678, "123456.78"],
    [Number.MAX_SAFE_INTEGER, "90071992547409.91"],
  ])("formats %s as canonical ungrouped BDT decimal text", (value, expected) => {
    expect(formatCanonicalBdt(poisha(value as number))).toBe(expected);
  });
});
