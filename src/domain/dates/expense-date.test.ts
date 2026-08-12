import { describe, expect, it } from "vitest";

import { DomainError } from "../shared/domain-error";
import { expenseDate } from "./expense-date";

function expectInvalid(value: string): void {
  try {
    expenseDate(value);
    throw new Error("Expected a domain error.");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("INVALID_EXPENSE_DATE");
  }
}

describe("expense date", () => {
  it.each(["2026-08-12", "2024-02-29", "2000-02-29"])(
    "accepts real date-only value %s",
    (value) => expect(expenseDate(value)).toBe(value),
  );

  it.each([
    "2023-02-29",
    "1900-02-29",
    "2026-00-01",
    "2026-13-01",
    "2026-04-31",
    "2026-01-00",
    "2026-1-01",
    "26-01-01",
    "2026-01-01T00:00:00Z",
    " 2026-01-01",
  ])("rejects invalid date-only value %s", expectInvalid);
});
