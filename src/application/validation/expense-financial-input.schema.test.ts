import { describe, expect, it } from "vitest";

import { allocateExpense } from "@/domain";
import { expenseFinancialInputSchema } from "./expense-financial-input.schema";

const equalInput = {
  creatorId: "creator",
  payerId: "creator",
  expenseAmount: "0.01",
  expenseDate: "2026-08-12",
  participantIds: ["c", "a", "b"],
  split: { method: "equal" as const },
};

describe("expense financial input boundary schema", () => {
  it("transforms decimal strings into branded exact domain values", () => {
    const parsed = expenseFinancialInputSchema.parse(equalInput);
    const plan = allocateExpense(parsed);

    expect(parsed.expenseAmount).toBe(1);
    expect(plan.allocations).toEqual([
      { participantId: "a", share: 1 },
      { participantId: "b", share: 0 },
      { participantId: "c", share: 0 },
    ]);
  });

  it("transforms exact amount split text", () => {
    const parsed = expenseFinancialInputSchema.parse({
      ...equalInput,
      expenseAmount: "10.00",
      participantIds: ["a", "b"],
      split: {
        method: "amount",
        entries: [
          { participantId: "a", amount: "6.75" },
          { participantId: "b", amount: "3.25" },
        ],
      },
    });

    expect(parsed.split).toMatchObject({
      method: "amount",
      entries: [
        { participantId: "a", amount: 675 },
        { participantId: "b", amount: 325 },
      ],
    });
  });

  it("transforms percentage text to integer basis points", () => {
    const parsed = expenseFinancialInputSchema.parse({
      ...equalInput,
      participantIds: ["a", "b", "c"],
      split: {
        method: "percentage",
        entries: [
          { participantId: "a", percentage: "33.34" },
          { participantId: "b", percentage: "33.33" },
          { participantId: "c", percentage: "33.33" },
        ],
      },
    });

    expect(parsed.split).toMatchObject({
      method: "percentage",
      entries: [
        { participantId: "a", basisPoints: 3_334 },
        { participantId: "b", basisPoints: 3_333 },
        { participantId: "c", basisPoints: 3_333 },
      ],
    });
  });

  it.each([
    [{ ...equalInput, expenseAmount: "0" }, "NON_POSITIVE_EXPENSE_AMOUNT"],
    [{ ...equalInput, expenseAmount: "1.001" }, "INVALID_MONEY_TEXT"],
    [{ ...equalInput, expenseDate: "2023-02-29" }, "INVALID_EXPENSE_DATE"],
    [{ ...equalInput, payerId: "other" }, "PAYER_CREATOR_MISMATCH"],
    [{ ...equalInput, participantIds: [] }, "NO_PARTICIPANTS"],
  ])("reports domain error codes for invalid boundary input", (input, code) => {
    const result = expenseFinancialInputSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(code as string);
    }
  });

  it("rejects an inexact amount split before it reaches application logic", () => {
    const result = expenseFinancialInputSchema.safeParse({
      ...equalInput,
      expenseAmount: "1.00",
      participantIds: ["a", "b"],
      split: {
        method: "amount",
        entries: [
          { participantId: "a", amount: "0.40" },
          { participantId: "b", amount: "0.40" },
        ],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "AMOUNT_SPLIT_TOTAL_MISMATCH",
      );
    }
  });
});
