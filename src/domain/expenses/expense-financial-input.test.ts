import { describe, expect, it } from "vitest";

import { expenseDate } from "../dates/expense-date";
import { basisPoints } from "../money/basis-points";
import { poisha, positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { userId } from "../shared/identifiers";
import { allocateExpense, type ExpenseFinancialInput } from "./expense-financial-input";

const base = {
  creatorId: userId("creator"),
  payerId: userId("creator"),
  expenseAmount: positivePoisha(1),
  expenseDate: expenseDate("2026-08-12"),
  participantIds: [userId("c"), userId("a"), userId("b")],
};

describe("expense financial allocation", () => {
  it("dispatches all approved split methods", () => {
    expect(
      allocateExpense({ ...base, split: { method: "equal" } }).method,
    ).toBe("equal");
    expect(
      allocateExpense({
        ...base,
        split: {
          method: "amount",
          entries: [
            { participantId: userId("a"), amount: poisha(1) },
            { participantId: userId("b"), amount: poisha(0) },
            { participantId: userId("c"), amount: poisha(0) },
          ],
        },
      }).method,
    ).toBe("amount");
    expect(
      allocateExpense({
        ...base,
        split: {
          method: "percentage",
          entries: [
            { participantId: userId("a"), basisPoints: basisPoints(3_334) },
            { participantId: userId("b"), basisPoints: basisPoints(3_333) },
            { participantId: userId("c"), basisPoints: basisPoints(3_333) },
          ],
        },
      }).method,
    ).toBe("percentage");
  });

  it("requires the payer to be the current user creating the expense", () => {
    const input: ExpenseFinancialInput = {
      ...base,
      payerId: userId("someone-else"),
      split: { method: "equal" },
    };

    expect(() => allocateExpense(input)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "PAYER_CREATOR_MISMATCH",
      }),
    );
  });
});
