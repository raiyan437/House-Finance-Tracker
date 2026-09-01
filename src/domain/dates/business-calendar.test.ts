import { describe, expect, it } from "vitest";
import { DomainError } from "../shared/domain-error";
import { isoInstant } from "../shared/instant";
import { expenseDate } from "./expense-date";
import {
  assertExpenseDateNotInFuture,
  assertExpenseDateWithinEntryWindow,
  businessDateAt,
  expenseDateWindowAt,
  expenseDateWindowForBusinessDate,
} from "./business-calendar";

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

  it("uses the exact September calendar window boundaries", () => {
    const now = isoInstant("2026-09-15T08:00:00.000Z");
    expect(expenseDateWindowAt(now)).toEqual({
      earliestAllowedDate: "2026-07-01",
      latestAllowedDate: "2026-09-15",
    });
    expect(() => assertExpenseDateWithinEntryWindow(expenseDate("2026-06-30"), now)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({ code: "EXPENSE_DATE_OUTSIDE_ALLOWED_WINDOW" }),
    );
    for (const allowed of ["2026-07-01", "2026-08-31", "2026-09-01", "2026-09-15"]) {
      expect(() => assertExpenseDateWithinEntryWindow(expenseDate(allowed), now)).not.toThrow();
    }
    expect(() => assertExpenseDateWithinEntryWindow(expenseDate("2026-09-16"), now)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({ code: "EXPENSE_DATE_IN_FUTURE" }),
    );
  });

  it.each([
    ["2026-01-31", "2025-11-01"],
    ["2026-02-28", "2025-12-01"],
    ["2028-02-29", "2027-12-01"],
    ["2026-03-01", "2026-01-01"],
    ["2026-10-01", "2026-08-01"],
    ["2027-01-01", "2026-11-01"],
  ])("derives %s from the first day exactly two calendar months earlier", (today, earliest) => {
    expect(expenseDateWindowForBusinessDate(expenseDate(today))).toEqual({
      earliestAllowedDate: earliest,
      latestAllowedDate: today,
    });
  });

  it("is stable across the UTC instant at Dhaka midnight", () => {
    expect(expenseDateWindowAt(isoInstant("2026-09-30T17:59:59.999Z"))).toEqual({
      earliestAllowedDate: "2026-07-01",
      latestAllowedDate: "2026-09-30",
    });
    expect(expenseDateWindowAt(isoInstant("2026-09-30T18:00:00.000Z"))).toEqual({
      earliestAllowedDate: "2026-08-01",
      latestAllowedDate: "2026-10-01",
    });
  });
});
