import Link from "next/link";
import type { AnalyticsExpenseView } from "@/application/analytics/analytics-page";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { formatExpenseDate } from "@/presentation/expenses/expense-ui";
import { ExpenseSemanticIcon } from "@/presentation/expenses/expense-icon";

interface ExpenseSummaryListProps {
  readonly expenses: readonly AnalyticsExpenseView[];
  readonly emptyMessage: string;
  readonly emptyAction?: React.ReactNode;
  readonly compact?: boolean;
}

export function ExpenseSummaryList({ expenses, emptyMessage, emptyAction, compact = false }: ExpenseSummaryListProps) {
  if (expenses.length === 0) {
    if (emptyAction) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center" data-slot="expense-summary-empty">
          <p className="text-body text-text-secondary">{emptyMessage}</p>
          <div className="flex justify-center">{emptyAction}</div>
        </div>
      );
    }
    return <p className="py-8 text-center text-body text-text-secondary">{emptyMessage}</p>;
  }
  return (
    <ul className={compact ? "" : "divide-y"}>
      {expenses.map((expense) => (
        <li className={compact ? "relative h-[46px]" : "relative py-4 first:pt-0 last:pb-0"} key={expense.expenseId}>
          <Link
            aria-label={`Open ${expense.name} expense details`}
            className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            href={`/expenses/${expense.expenseId}`}
            prefetch={false}
          />
          <div className={compact ? "grid h-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3" : "grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4"}>
            {compact ? <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft"><ExpenseSemanticIcon category={expense.iconCategory} className="size-4" /></span> : null}
            <div className="min-w-0">
              <p className={compact ? "truncate text-xs font-semibold" : "truncate font-medium"}>{expense.name}</p>
              <p className="text-mini text-text-muted">{formatExpenseDate(expense.expenseDate)}{compact ? ` · ${expense.payer.isCurrentUser ? "You" : expense.payer.displayName} · ${expense.paymentMethod === "cash" ? "Cash" : "Card"}` : ""}</p>
            </div>
            <p className={compact ? "hidden" : "text-sm text-text-secondary"}>
              {expense.payer.isCurrentUser ? "You" : expense.payer.displayName}
              {expense.payer.isFormerMember ? " · Former member" : ""}
              <span aria-hidden="true"> · </span>
              <span>{expense.paymentMethod === "cash" ? "Cash" : "Card"}</span>
            </p>
            <p className={compact ? "financial-numerals text-right text-xs font-semibold" : "financial-numerals text-xl font-semibold sm:text-right"}>{formatBdt(expense.amount)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
