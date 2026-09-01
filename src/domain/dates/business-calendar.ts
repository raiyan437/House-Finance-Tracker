import { expenseDate, type ExpenseDate } from "./expense-date";
import { isoInstant, type IsoInstant } from "../shared/instant";
import { DomainError } from "../shared/domain-error";

export const EXPENSE_BUSINESS_TIME_ZONE = "Asia/Dhaka";

const DHAKA_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: EXPENSE_BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function businessDateAt(instant: IsoInstant): ExpenseDate {
  isoInstant(instant);
  const parts = DHAKA_DATE_FORMATTER.formatToParts(new Date(instant));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new DomainError(
      "INVALID_INSTANT",
      "The authoritative instant could not be converted to the business calendar.",
    );
  }
  return expenseDate(`${year}-${month}-${day}`);
}

export interface ExpenseDateWindow {
  readonly earliestAllowedDate: ExpenseDate;
  readonly latestAllowedDate: ExpenseDate;
}

/**
 * Returns the inclusive Expense entry window using calendar months only.
 * The input is already the trusted Asia/Dhaka business date; no Date or
 * browser timezone participates in the month subtraction.
 */
export function expenseDateWindowForBusinessDate(
  currentBusinessDate: ExpenseDate,
): ExpenseDateWindow {
  expenseDate(currentBusinessDate);
  const year = Number(currentBusinessDate.slice(0, 4));
  const month = Number(currentBusinessDate.slice(5, 7));
  const zeroBasedTarget = year * 12 + month - 1 - 2;
  const targetYear = Math.floor(zeroBasedTarget / 12);
  const targetMonth = zeroBasedTarget - targetYear * 12 + 1;
  return Object.freeze({
    earliestAllowedDate: expenseDate(
      `${targetYear.toString().padStart(4, "0")}-${targetMonth.toString().padStart(2, "0")}-01`,
    ),
    latestAllowedDate: currentBusinessDate,
  });
}

export function expenseDateWindowAt(
  authoritativeInstant: IsoInstant,
): ExpenseDateWindow {
  return expenseDateWindowForBusinessDate(businessDateAt(authoritativeInstant));
}

export function assertExpenseDateNotBeforeAllowedWindow(
  proposedDate: ExpenseDate,
  authoritativeInstant: IsoInstant,
): void {
  expenseDate(proposedDate);
  const { earliestAllowedDate } = expenseDateWindowAt(authoritativeInstant);
  if (proposedDate < earliestAllowedDate) {
    throw new DomainError(
      "EXPENSE_DATE_OUTSIDE_ALLOWED_WINDOW",
      "Expenses can only be added for the current month and the previous two months.",
    );
  }
}

export function assertExpenseDateWithinEntryWindow(
  proposedDate: ExpenseDate,
  authoritativeInstant: IsoInstant,
): void {
  // Keep the lower-bound and future failures distinct for presentation.
  assertExpenseDateNotBeforeAllowedWindow(proposedDate, authoritativeInstant);
  assertExpenseDateNotInFuture(proposedDate, authoritativeInstant);
}

export function assertExpenseDateNotInFuture(
  proposedDate: ExpenseDate,
  authoritativeInstant: IsoInstant,
): void {
  expenseDate(proposedDate);
  const currentBusinessDate = businessDateAt(authoritativeInstant);
  if (proposedDate > currentBusinessDate) {
    throw new DomainError(
      "EXPENSE_DATE_IN_FUTURE",
      "Expense Date cannot be after the current Asia/Dhaka business date.",
    );
  }
}
