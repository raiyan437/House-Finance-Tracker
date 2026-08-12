import { describe, expect, it } from "vitest";

import { DomainError } from "./domain-error";
import {
  compareUserIds,
  expenseId,
  householdId,
  userId,
} from "./identifiers";

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected a domain error.");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe("opaque identifiers", () => {
  it("constructs the approved domain identifier types", () => {
    expect(userId("member-01")).toBe("member-01");
    expect(householdId("household-01")).toBe("household-01");
    expect(expenseId("expense-01")).toBe("expense-01");
  });

  it.each(["", " ", " member", "member "])(
    "rejects invalid identifier text %j",
    (value) => expectCode(() => userId(value), "INVALID_ID"),
  );

  it("uses case-sensitive deterministic code-unit ordering", () => {
    expect(compareUserIds(userId("A"), userId("a"))).toBe(-1);
    expect(compareUserIds(userId("a"), userId("a"))).toBe(0);
    expect(compareUserIds(userId("b"), userId("a"))).toBe(1);
  });
});
