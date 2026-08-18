import { describe, expect, it } from "vitest";
import { expenseDate, expenseId, isoInstant, poisha, userId } from "@/domain";
import {
  applyExpenseListQuery,
  defaultExpenseListQuery,
  type ExpenseListRow,
} from "./expense-query";

const payerA = { userId: userId("payer-a"), displayName: "A", former: false };
const payerB = { userId: userId("payer-b"), displayName: "B", former: true };
const rows: readonly ExpenseListRow[] = [
  { expenseId: expenseId("expense-z"), name: "Groceries", amount: poisha(100), expenseDate: expenseDate("2026-08-10"), createdAt: isoInstant("2026-08-11T00:00:00.000Z"), payer: payerA, paymentMethod: "cash", splitMethod: "equal", participantCount: 2 },
  { expenseId: expenseId("expense-a"), name: "Home Internet", amount: poisha(200), expenseDate: expenseDate("2026-08-10"), createdAt: isoInstant("2026-08-12T00:00:00.000Z"), payer: payerB, paymentMethod: "card", splitMethod: "amount", participantCount: 2 },
  { expenseId: expenseId("expense-b"), name: "internet backup", amount: poisha(300), expenseDate: expenseDate("2026-08-10"), createdAt: isoInstant("2026-08-12T00:00:00.000Z"), payer: payerB, paymentMethod: "card", splitMethod: "percentage", participantCount: 3 },
  { expenseId: expenseId("expense-old"), name: "Internet", amount: poisha(400), expenseDate: expenseDate("2026-07-31"), createdAt: isoInstant("2026-08-13T00:00:00.000Z"), payer: payerB, paymentMethod: "cash", splitMethod: "equal", participantCount: 1 },
];

describe("expense list query", () => {
  it("composes name, month, payer, and payment filters before sorting", () => {
    expect(
      applyExpenseListQuery([...rows].reverse(), {
        search: " INTERNET ",
        month: "2026-08",
        payerId: payerB.userId,
        paymentMethod: "card",
        sort: "newest",
      }).map((row) => row.expenseId),
    ).toEqual(["expense-a", "expense-b"]);
  });

  it("uses Expense Date, createdAt, and ascending ExpenseId deterministic ties", () => {
    expect(applyExpenseListQuery(rows, { ...defaultExpenseListQuery("2026-08"), month: "all" }).map((row) => row.expenseId)).toEqual([
      "expense-a",
      "expense-b",
      "expense-z",
      "expense-old",
    ]);
    expect(applyExpenseListQuery([...rows].reverse(), { ...defaultExpenseListQuery("2026-08"), month: "all", sort: "oldest" }).map((row) => row.expenseId)).toEqual([
      "expense-old",
      "expense-z",
      "expense-a",
      "expense-b",
    ]);
  });

  it("treats whitespace search as no filter and defaults to the local month", () => {
    const query = defaultExpenseListQuery("2026-08");
    expect(query).toMatchObject({ month: "2026-08", sort: "newest" });
    expect(applyExpenseListQuery(rows, { ...query, search: "   " })).toHaveLength(3);
  });
});
