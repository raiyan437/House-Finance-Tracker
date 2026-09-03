"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Banknote, ChevronLeft, ChevronRight, CreditCard, MessageCircle, Plus, Search } from "lucide-react";

import { tryCalendarMonth } from "@/application/analytics/calendar-month";
import { applyExpenseListQuery, defaultExpenseListQuery, type ExpenseListQuery, type ExpenseListRow } from "@/application/expenses/expense-query";
import type { ExpenseMemberView, ExpenseView } from "@/application/services/application-services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { userId } from "@/domain/shared/identifiers";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { ErrorState } from "@/presentation/components/async-state";
import { Surface } from "@/presentation/components/surface";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import { currentLocalMonth, formatExpenseDate } from "./expense-ui";
import { ExpenseSemanticIcon } from "./expense-icon";

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
  const [reloadTick, setReloadTick] = useState(0);

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
  }, [household, reloadTick, runtime]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.userId, member])), [members]);
  const rows = useMemo<readonly ExpenseListRow[]>(() => expenses.map(({ expense, commentCount }) => {
    const payer = memberById.get(expense.payerId);
    return {
      expenseId: expense.expenseId,
      name: expense.name,
      iconCategory: expense.iconCategory,
      commentCount: commentCount ?? 0,
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
        action={<Button asChild className="h-[46px] w-full rounded-xl sm:w-44"><Link href="/expenses/new"><Plus /> Add Expense</Link></Button>}
        description="Review household spending by the date it happened."
        title="Expenses"
      />

      <section aria-label="Expense filters" className="expense-filter-grid mt-[26px] grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-text-muted" />
          <Input aria-label="Search expenses by name" className="rounded-[12px] pl-10 text-row" placeholder="Search by expense name" value={query.search} onChange={(event) => updateQuery((current) => ({ ...current, search: event.target.value }))} />
        </div>
        <Select value={query.month} onValueChange={(value) => updateQuery((current) => ({ ...current, month: value as ExpenseListQuery["month"] }))}>
          <SelectTrigger aria-label="Month" size="compact"><SelectValue /></SelectTrigger>
          <SelectContent align="start"><SelectItem value="all">All Months</SelectItem>{months.map((month) => <SelectItem key={month} value={month}>{monthOptionLabel(month)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={query.payerId} onValueChange={(value) => updateQuery((current) => ({ ...current, payerId: value === "all" ? "all" : userId(value) }))}>
          <SelectTrigger aria-label="Paid By" size="compact"><SelectValue /></SelectTrigger>
          <SelectContent align="start"><SelectItem value="all">All Members</SelectItem>{payers.map((payer) => <SelectItem key={payer.userId} value={payer.userId}>{payer.displayName}{payer.former ? " (Former member)" : ""}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={query.paymentMethod} onValueChange={(value) => updateQuery((current) => ({ ...current, paymentMethod: value as ExpenseListQuery["paymentMethod"] }))}>
          <SelectTrigger aria-label="Payment Method" className="min-w-[9rem]" size="compact"><SelectValue>{query.paymentMethod === "all" ? "Payment Method" : undefined}</SelectValue></SelectTrigger>
          <SelectContent align="start"><SelectItem value="all">All Payment Methods</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem></SelectContent>
        </Select>
        <Select value={query.sort} onValueChange={(value) => updateQuery((current) => ({ ...current, sort: value as ExpenseListQuery["sort"] }))}>
          <SelectTrigger aria-label="Sort" size="compact"><SelectValue /></SelectTrigger>
          <SelectContent align="start"><SelectItem value="newest">Newest to Oldest</SelectItem><SelectItem value="oldest">Oldest to Newest</SelectItem></SelectContent>
        </Select>
        <Button className="rounded-[12px] border bg-card text-row" type="button" variant="ghost" onClick={() => updateQuery(() => defaultExpenseListQuery(currentLocalMonth()))}>Clear Filters</Button>
      </section>

      {status === "loading" ? <Surface className="mt-6"><p role="status" className="text-text-secondary">Loading expenses…</p></Surface> : null}
      {status === "error" ? (
        <Surface className="mt-6">
          <ErrorState description="Your saved expenses were not changed." onRetry={() => { setStatus("loading"); setReloadTick((value) => value + 1); }} title="Expenses could not be loaded" />
        </Surface>
      ) : null}
      {status === "ready" && rows.length === 0 ? (
        <Surface className="mt-6 py-12 text-center">
          <h2 className="panel-title">No expenses yet</h2>
          <p className="mt-2 text-sm text-text-secondary">Record the first household expense to see it here.</p>
          <Button asChild className="mt-5 w-full sm:w-fit"><Link href="/expenses/new"><Plus /> Add Expense</Link></Button>
        </Surface>
      ) : null}
      {status === "ready" && rows.length > 0 && visibleRows.length === 0 ? (
        <Surface className="mt-6 py-12 text-center">
          <h2 className="panel-title">No matching expenses</h2>
          <p className="mt-2 text-sm text-text-secondary">No expenses match the current search and filters.</p>
          <Button className="mt-5 w-full rounded-xl sm:w-fit" variant="outline" onClick={() => updateQuery(() => defaultExpenseListQuery(currentLocalMonth()))}>Clear Filters</Button>
        </Surface>
      ) : null}

      {status === "ready" && visibleRows.length > 0 ? (
        <Surface className="mt-6 overflow-hidden shadow-none" padding="none">
          <div className="flex min-h-[62px] items-center justify-between gap-4 border-b px-5">
            <div><h2 aria-label="Monthly spending list" className="panel-title">{expenseListTitle(query.month)}</h2><p aria-live="polite" className="compact-caption mt-0.5 text-text-muted">{visibleRows.length} result{visibleRows.length === 1 ? "" : "s"}</p></div>
            <p className="hidden compact-caption text-text-muted sm:block">Sorted {query.sort === "newest" ? "newest first" : "oldest first"}</p>
          </div>
          <div>
            <div aria-hidden="true" className="table-label hidden h-11 grid-cols-[minmax(0,1.4fr)_80px_104px_136px_100px_104px_100px] items-center gap-3 border-b bg-secondary/60 px-5 text-text-secondary min-[900px]:grid min-[1400px]:grid-cols-[minmax(0,1.6fr)_90px_118px_160px_108px_120px_110px]"><span>Expense</span><span>Comments</span><span>Date</span><span>Paid By</span><span>Payment</span><span>Split</span><span className="text-right">Amount</span></div>
            <ul className="divide-y">
              {pagedRows.map((row) => (
                <li className="group relative min-h-[84px] transition-colors hover:bg-secondary/70 focus-within:rounded-xl focus-within:bg-secondary/70 min-[900px]:h-[72px] min-[900px]:min-h-0 min-[900px]:focus-within:mx-2" key={row.expenseId}>
                  <Link aria-label={`Open ${row.name} expense details`} className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30" href={`/expenses/${row.expenseId}`} />
                  <div className="table-body grid h-full grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-4 min-[900px]:grid-cols-[minmax(0,1.4fr)_80px_104px_136px_100px_104px_100px] min-[900px]:items-center min-[900px]:px-5 min-[900px]:py-0 min-[1400px]:grid-cols-[minmax(0,1.6fr)_90px_118px_160px_108px_120px_110px]">
                    <div className="contents min-[900px]:flex min-[900px]:min-w-0 min-[900px]:items-center min-[900px]:gap-3"><span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${expenseTileClass(row.expenseId)}`}><ExpenseSemanticIcon category={row.iconCategory} className="size-4" /></span><div className="min-w-0"><p className="truncate font-semibold text-foreground">{row.name}</p><p className="mt-1 text-xs text-text-muted min-[900px]:hidden"><span className="inline-flex items-center gap-1"><MessageCircle aria-hidden="true" className="size-3" />{row.commentCount ?? 0}</span> · {formatExpenseDate(row.expenseDate)} · {row.payer.displayName}</p><p className="mt-1 text-xs text-text-secondary min-[900px]:hidden">{row.paymentMethod === "cash" ? "Cash" : "Card"} · {splitLabel(row)}</p></div></div>
                    <p className="hidden items-center gap-1 text-text-secondary min-[900px]:flex"><MessageCircle aria-hidden="true" className="size-4" /><span>{row.commentCount ?? 0}</span></p>
                    <p className="hidden text-text-secondary min-[900px]:block"><time dateTime={row.expenseDate}>{formatExpenseDate(row.expenseDate)}</time></p>
                    <div className="hidden min-w-0 items-center gap-2 min-[900px]:flex"><MemberAvatar className="size-7 shrink-0 [&_[data-slot=avatar-fallback]]:text-[9px]" displayName={row.payer.displayName} userId={row.payer.userId} /><p className="truncate text-text-secondary">{row.payer.displayName}{row.payer.former ? " · Former" : ""}</p></div>
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
              <Button aria-label="Previous expenses page" className="size-11 rounded-xl lg:size-9" disabled={safePage === 1} onClick={() => setPage(Math.max(1, safePage - 1))} size="icon" variant="outline"><ChevronLeft /></Button>
              <span aria-current="page" className="financial-numerals min-w-8 text-center text-xs">{safePage} / {pageCount}</span>
              <Button aria-label="Next expenses page" className="size-11 rounded-xl lg:size-9" disabled={safePage === pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))} size="icon" variant="outline"><ChevronRight /></Button>
            </div>
          </nav>
        </Surface>
      ) : null}
    </PageContainer>
  );
}
