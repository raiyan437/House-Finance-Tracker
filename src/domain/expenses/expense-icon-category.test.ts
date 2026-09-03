import { describe, expect, it } from "vitest";

import { DomainError } from "../shared/domain-error";
import { EXPENSE_ICON_CATEGORIES, expenseIconCategory } from "./expense-icon-category";

describe("Expense semantic icon category", () => {
  it("accepts every approved stable value", () => {
    expect(EXPENSE_ICON_CATEGORIES.map(expenseIconCategory)).toEqual([
      "internet", "gas", "groceries", "food", "entertainment",
      "cigarettes", "pets", "repairs", "housing", "others",
    ]);
  });

  it("normalizes a missing legacy value to Others", () => {
    expect(expenseIconCategory(undefined)).toBe("others");
  });

  it("rejects values outside the frozen vocabulary", () => {
    expect(() => expenseIconCategory("ReceiptText")).toThrowError(
      expect.objectContaining<Partial<DomainError>>({ code: "INVALID_EXPENSE" }),
    );
  });
});
