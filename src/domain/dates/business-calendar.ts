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
