import { describe, expect, it } from "vitest";
import { DomainError } from "../shared/domain-error";
import { isoInstant } from "../shared/instant";
import { expenseDate } from "./expense-date";
import { assertExpenseDateNotInFuture, businessDateAt } from "./business-calendar";

describe("Asia/Dhaka Expense business calendar", () => {
  it("uses Dhaka midnight rather than the browser timezone", () => {
    expect(businessDateAt(isoInstant("2026-08-21T17:59:59.999Z"))).toBe("2026-08-21");
    expect(businessDateAt(isoInstant("2026-08-21T18:00:00.000Z"))).toBe("2026-08-22");
  });

  it("allows yesterday and today but rejects tomorrow", () => {
    const now = isoInstant("2026-08-22T12:00:00.000Z");
    expect(() => assertExpenseDateNotInFuture(expenseDate("2026-08-21"), now)).not.toThrow();
    expect(() => assertExpenseDateNotInFuture(expenseDate("2026-08-22"), now)).not.toThrow();
    expect(() => assertExpenseDateNotInFuture(expenseDate("2026-08-23"), now)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({ code: "EXPENSE_DATE_IN_FUTURE" }),
    );
  });
});
