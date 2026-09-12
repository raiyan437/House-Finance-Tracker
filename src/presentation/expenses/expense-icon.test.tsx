import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EXPENSE_ICON_OPTIONS, expenseIconOption, ExpenseSemanticIcon } from "./expense-icon";

describe("Expense icon registry", () => {
  it("keeps the approved 12-value persistence order and display labels", () => {
    expect(EXPENSE_ICON_OPTIONS.map(({ value, label, order }) => [value, label, order])).toEqual([
      ["internet", "Wifi", 1],
      ["electricity", "Electricity", 2],
      ["gas", "Gas", 3],
      ["groceries", "Groceries", 4],
      ["food", "Food", 5],
      ["entertainment", "Entertainment", 6],
      ["cigarettes", "Cigarettes", 7],
      ["pets", "Pet", 8],
      ["repairs", "Repair", 9],
      ["housing", "Household", 10],
      ["loan", "Loan", 11],
      ["others", "Other", 12],
    ]);
    expect(EXPENSE_ICON_OPTIONS.every(({ iconAsset }) => iconAsset.startsWith("/icons/expense-categories/"))).toBe(true);
  });

  it("falls back missing categories to the Other asset and keeps semantic labels accessible", () => {
    expect(expenseIconOption(undefined)).toMatchObject({ value: "others", label: "Other", iconAsset: "/icons/expense-categories/other.png" });
    render(<ExpenseSemanticIcon category="housing" className="size-5" />);
    expect(screen.getByRole("img", { name: "Household category" })).toBeInTheDocument();
    expect(document.querySelector('img[src="/icons/expense-categories/household.png"]')).toBeInTheDocument();
  });
});
