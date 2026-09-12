import { describe, expect, it } from "vitest";
import { expenseFormSchema } from "./expense-form.schema";

const base = {
  name: "Electricity bill",
  amountText: "100",
  expenseDateText: "2026-09-13",
  paymentMethod: "cash",
  selectedCardId: "",
  participantIds: ["user-a"],
  splitMethod: "equal",
  amountTextByParticipant: {},
  percentageTextByParticipant: {},
};

describe("Expense form category validation", () => {
  it("accepts the two new semantic values and rejects an unknown value", () => {
    expect(expenseFormSchema.safeParse({ ...base, iconCategory: "electricity" }).success).toBe(true);
    expect(expenseFormSchema.safeParse({ ...base, iconCategory: "loan" }).success).toBe(true);
    expect(expenseFormSchema.safeParse({ ...base, iconCategory: "wifi" }).success).toBe(false);
  });
});
