"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Banknote, ChevronLeft, ChevronRight, CreditCard, Plus, ReceiptText, Search } from "lucide-react";

import { tryCalendarMonth } from "@/application/analytics/calendar-month";
import { applyExpenseListQuery, defaultExpenseListQuery, type ExpenseListQuery, type ExpenseListRow } from "@/application/expenses/expense-query";
import type { ExpenseMemberView, ExpenseView } from "@/application/services/application-services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { userId } from "@/domain/shared/identifiers";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { Surface } from "@/presentation/components/surface";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { currentLocalMonth, formatExpenseDate, selectClassName } from "./expense-ui";

const EXPENSES_PER_PAGE = 8;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

function expenseListTitle(month: ExpenseListQuery["month"]): string {
  if (month === "all") return "All Expenses";
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} Expenses`;
}

function monthOptionLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}

function splitLabel(row: ExpenseListRow): string {
  const method = row.splitMethod === "equal" ? "Equal" : row.splitMethod === "percentage" ? "Percentage" : "Amounts";
  return `${method} · ${row.participantCount}`;
}

function expenseTileClass(expenseId: ExpenseListRow["expenseId"]): string {
  const palette = ["bg-brand-soft", "bg-info-soft", "bg-warning-soft", "bg-success-soft"] as const;
  const hash = [...expenseId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

export function ExpensesPageClient() {
  const runtime = useApplicationRuntime();
  const searchParams = useSearchParams();
  const monthValues = searchParams.getAll("month");
  const initialMonth = monthValues.length === 1 ? tryCalendarMonth(monthValues[0]) ?? currentLocalMonth() : currentLocalMonth();
  const [expenses, setExpenses] = useState<readonly ExpenseView[]>([]);
  const [members, setMembers] = useState<readonly ExpenseMemberView[]>([]);
  const [query, setQuery] = useState<ExpenseListQuery>(() => defaultExpenseListQuery(initialMonth));
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const household = runtime.status === "ready" && (runtime.household.status === "active-member" || runtime.household.status === "active-leader") ? runtime.household.household : undefined;

  useEffect(() => {
    if (runtime.status !== "ready" || !household) return;
    let active = true;
    void Promise.all([
      runtime.expenseActions.listExpenses(household.householdId),
      runtime.expenseActions.listMembers(household.householdId),
    ]).then(([nextExpenses, nextMembers]) => {
      if (!active) return;
      setExpenses(nextExpenses);
      setMembers(nextMembers);
      setStatus("ready");
    }).catch(() => active && setStatus("error"));
    return () => { active = false; };
  }, [household, runtime]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.userId, member])), [members]);
  const rows = useMemo<readonly ExpenseListRow[]>(() => expenses.map(({ expense }) => {
    const payer = memberById.get(expense.payerId);
    return {
      expenseId: expense.expenseId,
      name: expense.name,
      amount: expense.amount,
      expenseDate: expense.expenseDate,
      createdAt: expense.createdAt,
      payer: { userId: expense.payerId, displayName: payer?.displayName ?? "Unknown member", former: payer?.status === "former" },
      paymentMethod: expense.payment.method,
      splitMethod: expense.splitMethod,
      participantCount: expense.allocations.length,
    };
  }), [expenses, memberById]);
  const visibleRows = useMemo(() => applyExpenseListQuery(rows, query), [query, rows]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / EXPENSES_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = useMemo(() => visibleRows.slice((safePage - 1) * EXPENSES_PER_PAGE, safePage * EXPENSES_PER_PAGE), [safePage, visibleRows]);
  const months = useMemo(() => [...new Set([currentLocalMonth(), ...rows.map((row) => row.expenseDate.slice(0, 7))])].sort().reverse(), [rows]);
  const payers = useMemo(() => [...new Map(rows.map((row) => [row.payer.userId, row.payer])).values()].sort((a, b) => a.displayName.localeCompare(b.displayName)), [rows]);

  const updateQuery = (update: (current: ExpenseListQuery) => ExpenseListQuery) => {
    setQuery(update);
    setPage(1);
  };

  return (
    <PageContainer>
      <PageHeader
        action={<Button asChild className="h-[46px] w-full rounded-[14px] sm:w-44"><Link href="/expenses/new"><Plus /> Add Expense</Link></Button>}
        description="Review household spending by the date it happened."
        title="Expenses"
      />

      <section aria-label="Expense filters" className="expense-filter-grid mt-[26px] grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-text-muted" />
          <Input aria-label="Search expenses by name" className="rounded-[12px] pl-10 text-[13px]" placeholder="Search by expense name" value={query.search} onChange={(event) => updateQuery((current) => ({ ...current, search: event.target.value }))} />
        </div>
        <label><span className="sr-only">Month</span><select aria-label="Month" className={`${selectClassName()} rounded-[12px] text-[13px]`} value={query.month} onChange={(event) => updateQuery((current) => ({ ...current, month: event.target.value as ExpenseListQuery["month"] }))}><option value="all">All Months</option>{months.map((month) => <option key={month} value={month}>{monthOptionLabel(month)}</option>)}</select></label>
        <label><span className="sr-only">Paid By</span><select aria-label="Paid By" className={`${selectClassName()} rounded-[12px] text-[13px]`} value={query.payerId} onChange={(event) => updateQuery((current) => ({ ...current, payerId: event.target.value === "all" ? "all" : userId(event.target.value) }))}><option value="all">All payers</option>{payers.map((payer) => <option key={payer.userId} value={payer.userId}>{payer.displayName}{payer.former ? " (Former member)" : ""}</option>)}</select></label>
        <label><span className="sr-only">Payment</span><select aria-label="Payment" className={`${selectClassName()} rounded-[12px] text-[13px]`} value={query.paymentMethod} onChange={(event) => updateQuery((current) => ({ ...current, paymentMethod: event.target.value as ExpenseListQuery["paymentMethod"] }))}><option value="all">All payments</option><option value="cash">Cash</option><option value="card">Card</option></select></label>
        <label><span className="sr-only">Sort</span><select aria-label="Sort" className={`${selectClassName()} rounded-[12px] text-[13px]`} value={query.sort} onChange={(event) => updateQuery((current) => ({ ...current, sort: event.target.value as ExpenseListQuery["sort"] }))}><option value="newest">Newest to Oldest</option><option value="oldest">Oldest to Newest</option></select></label>
        <Button className="rounded-[12px] border bg-card text-[13px]" type="button" variant="ghost" onClick={() => updateQuery(() => defaultExpenseListQuery(currentLocalMonth()))}>Clear Filters</Button>
      </section>

      {status === "loading" ? <Surface className="mt-6"><p role="status" className="text-text-secondary">Loading expenses…</p></Surface> : null}
      {status === "error" ? <Surface className="mt-6"><p role="alert" className="text-danger">Expenses could not be loaded.</p></Surface> : null}
      {status === "ready" && visibleRows.length === 0 ? <Surface className="mt-6 py-12 text-center"><h2 className="panel-title">No matching expenses</h2><p className="mt-2 text-sm text-text-secondary">Try clearing the filters or add a household expense.</p></Surface> : null}

      {status === "ready" && visibleRows.length > 0 ? (
        <Surface className="mt-6 overflow-hidden shadow-none" padding="none">
          <div className="flex min-h-[62px] items-center justify-between gap-4 border-b px-5">
            <div><h2 aria-label="Monthly spending list" className="panel-title">{expenseListTitle(query.month)}</h2><p className="compact-caption mt-0.5 text-text-muted">{visibleRows.length} result{visibleRows.length === 1 ? "" : "s"}</p></div>
            <p className="hidden compact-caption text-text-muted sm:block">Sorted {query.sort === "newest" ? "newest first" : "oldest first"}</p>
          </div>
          <div>
            <div aria-hidden="true" className="table-label hidden h-11 grid-cols-[minmax(0,1.4fr)_104px_136px_100px_104px_100px] items-center gap-3 border-b bg-secondary/60 px-5 text-text-secondary min-[900px]:grid min-[1400px]:grid-cols-[minmax(0,1.6fr)_118px_160px_108px_120px_110px]"><span>Expense</span><span>Date</span><span>Paid By</span><span>Payment</span><span>Split</span><span className="text-right">Amount</span></div>
            <ul className="divide-y">
              {pagedRows.map((row) => (
                <li className="group relative min-h-[84px] transition-colors hover:bg-secondary/70 focus-within:rounded-xl focus-within:bg-secondary/70 min-[900px]:h-[72px] min-[900px]:min-h-0 min-[900px]:focus-within:mx-2" key={row.expenseId}>
                  <Link aria-label={`Open ${row.name} expense details`} className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30" href={`/expenses/${row.expenseId}`} />
                  <div className="table-body grid h-full grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-4 min-[900px]:grid-cols-[minmax(0,1.4fr)_104px_136px_100px_104px_100px] min-[900px]:items-center min-[900px]:px-5 min-[900px]:py-0 min-[1400px]:grid-cols-[minmax(0,1.6fr)_118px_160px_108px_120px_110px]">
                    <div className="contents min-[900px]:flex min-[900px]:min-w-0 min-[900px]:items-center min-[900px]:gap-3"><span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${expenseTileClass(row.expenseId)}`}><ReceiptText aria-hidden="true" className="size-4" /></span><div className="min-w-0"><p className="truncate font-semibold text-foreground">{row.name}</p><p className="mt-1 text-xs text-text-muted min-[900px]:hidden">{formatExpenseDate(row.expenseDate)} · {row.payer.displayName}</p><p className="mt-1 text-xs text-text-secondary min-[900px]:hidden">{row.paymentMethod === "cash" ? "Cash" : "Card"} · {splitLabel(row)}</p></div></div>
                    <p className="hidden text-text-secondary min-[900px]:block">{formatExpenseDate(row.expenseDate)}</p>
                    <div className="hidden min-w-0 items-center gap-2 min-[900px]:flex"><MemberAvatar className="size-7 shrink-0 [&_[data-slot=avatar-fallback]]:text-[9px]" displayName={row.payer.displayName} /><p className="truncate text-text-secondary">{row.payer.displayName}{row.payer.former ? " · Former" : ""}</p></div>
                    <p className="hidden min-[900px]:block"><span className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ${row.paymentMethod === "cash" ? "bg-secondary text-text-secondary" : "bg-brand-soft text-foreground"}`}>{row.paymentMethod === "cash" ? <Banknote aria-hidden="true" className="size-3.5" /> : <CreditCard aria-hidden="true" className="size-3.5" />}{row.paymentMethod === "cash" ? "Cash" : "Card"}</span></p>
                    <p className="hidden text-text-secondary min-[900px]:block">{splitLabel(row)}</p>
                    <p className="financial-numerals text-right text-[15px] font-semibold">{formatBdt(row.amount)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Expenses pagination" className="flex min-h-14 items-center justify-between gap-4 border-t px-5">
            <p className="compact-caption text-text-muted">Showing {(safePage - 1) * EXPENSES_PER_PAGE + 1}–{Math.min(safePage * EXPENSES_PER_PAGE, visibleRows.length)} of {visibleRows.length}</p>
            <div className="flex items-center gap-2">
              <Button aria-label="Previous expenses page" className="size-8 rounded-lg" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))} size="icon-xs" variant="outline"><ChevronLeft /></Button>
              <span aria-current="page" className="financial-numerals min-w-8 text-center text-xs">{safePage} / {pageCount}</span>
              <Button aria-label="Next expenses page" className="size-8 rounded-lg" disabled={safePage === pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))} size="icon-xs" variant="outline"><ChevronRight /></Button>
            </div>
          </nav>
        </Surface>
      ) : null}
    </PageContainer>
  );
}
