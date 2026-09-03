import { DomainError } from "../shared/domain-error";

export const EXPENSE_ICON_CATEGORIES = [
  "internet", "gas", "groceries", "food", "entertainment",
  "cigarettes", "pets", "repairs", "housing", "others",
] as const;

export type ExpenseIconCategory = (typeof EXPENSE_ICON_CATEGORIES)[number];

export function expenseIconCategory(value: string | undefined): ExpenseIconCategory {
  if (value === undefined) return "others";
  if (!EXPENSE_ICON_CATEGORIES.includes(value as ExpenseIconCategory)) {
    throw new DomainError("INVALID_EXPENSE", "Unsupported Expense category.");
  }
  return value as ExpenseIconCategory;
}
