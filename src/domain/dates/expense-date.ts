import { DomainError } from "../shared/domain-error";

declare const expenseDateBrand: unique symbol;

export type ExpenseDate = string & {
  readonly [expenseDateBrand]: "ExpenseDate";
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

export function expenseDate(value: string): ExpenseDate {
  const match = DATE_ONLY.exec(value);

  if (!match) {
    throw new DomainError(
      "INVALID_EXPENSE_DATE",
      "An expense date must use the YYYY-MM-DD date-only format.",
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new DomainError(
      "INVALID_EXPENSE_DATE",
      "An expense date must be a real Gregorian calendar date.",
    );
  }

  return value as ExpenseDate;
}
