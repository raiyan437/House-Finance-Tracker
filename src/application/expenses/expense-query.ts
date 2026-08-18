import type {
  ExpenseDate,
  ExpenseId,
  IsoInstant,
  Poisha,
  SplitMethod,
  UserId,
} from "@/domain";

export type ExpenseSortOrder = "newest" | "oldest";

export interface ExpenseListPayer {
  readonly userId: UserId;
  readonly displayName: string;
  readonly former: boolean;
}

export interface ExpenseListRow {
  readonly expenseId: ExpenseId;
  readonly name: string;
  readonly amount: Poisha;
  readonly expenseDate: ExpenseDate;
  readonly createdAt: IsoInstant;
  readonly payer: ExpenseListPayer;
  readonly paymentMethod: "cash" | "card";
  readonly splitMethod: SplitMethod;
  readonly participantCount: number;
}

export interface ExpenseListQuery {
  readonly search: string;
  readonly month: string | "all";
  readonly payerId: UserId | "all";
  readonly paymentMethod: "cash" | "card" | "all";
  readonly sort: ExpenseSortOrder;
}

export function defaultExpenseListQuery(currentMonth: string): ExpenseListQuery {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(currentMonth)) {
    throw new Error("Current month must be YYYY-MM.");
  }
  return {
    search: "",
    month: currentMonth,
    payerId: "all",
    paymentMethod: "all",
    sort: "newest",
  };
}

export function applyExpenseListQuery(
  rows: readonly ExpenseListRow[],
  query: ExpenseListQuery,
): readonly ExpenseListRow[] {
  const search = query.search.trim().toLocaleLowerCase("en");
  const direction = query.sort === "newest" ? -1 : 1;

  return rows
    .filter((row) => !search || row.name.toLocaleLowerCase("en").includes(search))
    .filter((row) => query.month === "all" || row.expenseDate.slice(0, 7) === query.month)
    .filter((row) => query.payerId === "all" || row.payer.userId === query.payerId)
    .filter((row) => query.paymentMethod === "all" || row.paymentMethod === query.paymentMethod)
    .sort((left, right) => {
      const expenseDateOrder = left.expenseDate.localeCompare(right.expenseDate) * direction;
      if (expenseDateOrder !== 0) return expenseDateOrder;
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt) * direction;
      if (createdAtOrder !== 0) return createdAtOrder;
      return left.expenseId.localeCompare(right.expenseId);
    });
}
