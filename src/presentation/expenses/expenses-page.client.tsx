"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import {
  applyExpenseListQuery,
  defaultExpenseListQuery,
  type ExpenseListQuery,
  type ExpenseListRow,
} from "@/application/expenses/expense-query";
import type {
  ExpenseMemberView,
  ExpenseView,
} from "@/application/services/application-services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { Surface } from "@/presentation/components/surface";
import { currentLocalMonth, formatExpenseDate, selectClassName } from "./expense-ui";
import { userId } from "@/domain/shared/identifiers";

export function ExpensesPageClient() {
  const runtime = useApplicationRuntime();
  const [expenses, setExpenses] = useState<readonly ExpenseView[]>([]);
  const [members, setMembers] = useState<readonly ExpenseMemberView[]>([]);
  const [query, setQuery] = useState<ExpenseListQuery>(() =>
    defaultExpenseListQuery(currentLocalMonth()),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const household = runtime.status === "ready" &&
    (runtime.household.status === "active-member" || runtime.household.status === "active-leader")
    ? runtime.household.household
    : undefined;

  useEffect(() => {
    if (runtime.status !== "ready" || !household) return;
    let active = true;
    void Promise.all([
      runtime.expenseActions.listExpenses(household.householdId),
      runtime.expenseActions.listMembers(household.householdId),
    ])
      .then(([nextExpenses, nextMembers]) => {
        if (!active) return;
        setExpenses(nextExpenses);
        setMembers(nextMembers);
        setStatus("ready");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [household, runtime]);

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  );
  const rows = useMemo<readonly ExpenseListRow[]>(
    () =>
      expenses.map(({ expense }) => {
        const payer = memberById.get(expense.payerId);
        return {
          expenseId: expense.expenseId,
          name: expense.name,
          amount: expense.amount,
          expenseDate: expense.expenseDate,
          createdAt: expense.createdAt,
          payer: {
            userId: expense.payerId,
            displayName: payer?.displayName ?? "Unknown member",
            former: payer?.status === "former",
          },
          paymentMethod: expense.payment.method,
          splitMethod: expense.splitMethod,
          participantCount: expense.allocations.length,
        };
      }),
    [expenses, memberById],
  );
  const visibleRows = useMemo(() => applyExpenseListQuery(rows, query), [query, rows]);
  const months = useMemo(
    () =>
      [...new Set([currentLocalMonth(), ...rows.map((row) => row.expenseDate.slice(0, 7))])]
        .sort()
        .reverse(),
    [rows],
  );
  const payers = useMemo(
    () =>
      [...new Map(rows.map((row) => [row.payer.userId, row.payer])).values()].sort(
        (a, b) => a.displayName.localeCompare(b.displayName),
      ),
    [rows],
  );

  const clearFilters = () => setQuery(defaultExpenseListQuery(currentLocalMonth()));

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Review household spending by the date it happened."
        action={
          <Button asChild className="w-full sm:w-auto">
            <Link href="/expenses/new"><Plus /> Add Expense</Link>
          </Button>
        }
      />

      <Surface className="space-y-4" padding="small">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 size-5 text-text-muted" aria-hidden="true" />
          <Input
            aria-label="Search expenses by name"
            className="pl-10"
            placeholder="Search by expense name"
            value={query.search}
            onChange={(event) => setQuery((current) => ({ ...current, search: event.target.value }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-label text-text-secondary">
            <span>Month</span>
            <select className={selectClassName()} value={query.month} onChange={(event) => setQuery((current) => ({ ...current, month: event.target.value as ExpenseListQuery["month"] }))}>
              <option value="all">All Months</option>
              {months.map((month) => <option key={month} value={month}>{month}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-label text-text-secondary">
            <span>Paid By</span>
            <select className={selectClassName()} value={query.payerId} onChange={(event) => setQuery((current) => ({ ...current, payerId: event.target.value === "all" ? "all" : userId(event.target.value) }))}>
              <option value="all">All payers</option>
              {payers.map((payer) => <option key={payer.userId} value={payer.userId}>{payer.displayName}{payer.former ? " (Former member)" : ""}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-label text-text-secondary">
            <span>Payment</span>
            <select className={selectClassName()} value={query.paymentMethod} onChange={(event) => setQuery((current) => ({ ...current, paymentMethod: event.target.value as ExpenseListQuery["paymentMethod"] }))}>
              <option value="all">All payment methods</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
            </select>
          </label>
          <label className="space-y-1 text-label text-text-secondary">
            <span>Sort</span>
            <select className={selectClassName()} value={query.sort} onChange={(event) => setQuery((current) => ({ ...current, sort: event.target.value as ExpenseListQuery["sort"] }))}>
              <option value="newest">Newest to Oldest</option>
              <option value="oldest">Oldest to Newest</option>
            </select>
          </label>
        </div>
        <Button type="button" variant="ghost" onClick={clearFilters}>Clear Filters</Button>
      </Surface>

      {status === "loading" ? <Surface><p role="status" className="text-text-secondary">Loading expenses…</p></Surface> : null}
      {status === "error" ? <Surface><p role="alert" className="text-danger">Expenses could not be loaded.</p></Surface> : null}
      {status === "ready" && visibleRows.length === 0 ? (
        <Surface className="py-12 text-center"><h2 className="text-h3">No matching expenses</h2><p className="mt-2 text-text-secondary">Try clearing the filters or add a household expense.</p></Surface>
      ) : null}

      {status === "ready" && visibleRows.length > 0 ? (
        <Surface padding="none" className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] gap-4 border-b bg-secondary px-5 py-3 text-label text-text-secondary md:grid" aria-hidden="true">
            <span>Expense</span><span>Date</span><span>Paid By</span><span>Payment</span><span className="text-right">Amount</span>
          </div>
          <ul className="divide-y">
            {visibleRows.map((row) => (
              <li key={row.expenseId} className="relative transition-colors hover:bg-secondary/70 focus-within:bg-secondary/70">
                <Link className="absolute inset-0 z-10 rounded focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30" href={`/expenses/${row.expenseId}`} aria-label={`Open ${row.name} expense details`} />
                <div className="grid gap-2 p-4 md:grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_auto] md:items-center md:gap-4 md:px-5 md:py-4">
                  <div><p className="font-medium text-foreground">{row.name}</p><p className="text-caption text-text-muted md:hidden">{row.participantCount} participant{row.participantCount === 1 ? "" : "s"}</p></div>
                  <p className="text-sm text-text-secondary">{formatExpenseDate(row.expenseDate)}</p>
                  <p className="text-sm text-text-secondary">{row.payer.displayName}{row.payer.former ? " · Former member" : ""}</p>
                  <p className="text-sm capitalize text-text-secondary">{row.paymentMethod}</p>
                  <p className="text-lg font-semibold tabular-nums md:text-right">{formatBdt(row.amount)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}
    </PageContainer>
  );
}
