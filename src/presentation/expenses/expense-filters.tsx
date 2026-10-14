"use client";

import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { ExpenseListQuery, ExpenseListRow } from "@/application/expenses/expense-query";
import { defaultExpenseListQuery } from "@/application/expenses/expense-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { userId } from "@/domain/shared/identifiers";
import { usePhoneLayout } from "@/presentation/components/use-phone-layout";
import { currentLocalMonth } from "./expense-ui";

interface ExpenseFiltersProps {
  readonly query: ExpenseListQuery;
  readonly months: readonly string[];
  readonly payers: readonly ExpenseListRow["payer"][];
  readonly updateQuery: (update: (query: ExpenseListQuery) => ExpenseListQuery) => void;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

function monthOptionLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;
}

function ExpenseFilterSelect({ label, children, triggerClassName, displayValue, ...props }: React.ComponentProps<typeof Select> & {
  readonly label: string;
  readonly triggerClassName?: string;
  readonly displayValue?: string;
}) {
  return (
    <div>
      <span aria-hidden="true" className="expense-filter-label">{label}</span>
      <Select {...props}>
        <SelectTrigger aria-label={label} className={triggerClassName} size="compact"><SelectValue>{displayValue}</SelectValue></SelectTrigger>
        <SelectContent align="start">{children}</SelectContent>
      </Select>
    </div>
  );
}

function ExpenseMonthFilter({ query, months, updateQuery }: ExpenseFiltersProps) {
  return (
    <ExpenseFilterSelect label="Month" value={query.month} onValueChange={(value) => updateQuery((current) => ({ ...current, month: value as ExpenseListQuery["month"] }))}>
      <SelectItem value="all">All Months</SelectItem>{months.map((month) => <SelectItem key={month} value={month}>{monthOptionLabel(month)}</SelectItem>)}
    </ExpenseFilterSelect>
  );
}

function ExpenseAdditionalFilters({ query, payers, updateQuery }: ExpenseFiltersProps) {
  return <>
    <ExpenseFilterSelect label="Paid By" value={query.payerId} onValueChange={(value) => updateQuery((current) => ({ ...current, payerId: value === "all" ? "all" : userId(value) }))}>
      <SelectItem value="all">All Members</SelectItem>{payers.map((payer) => <SelectItem key={payer.userId} value={payer.userId}>{payer.displayName}{payer.former ? " (Former member)" : ""}</SelectItem>)}
    </ExpenseFilterSelect>
    <ExpenseFilterSelect label="Payment Method" triggerClassName="min-w-[9rem]" displayValue={query.paymentMethod === "all" ? "Payment Method" : undefined} value={query.paymentMethod} onValueChange={(value) => updateQuery((current) => ({ ...current, paymentMethod: value as ExpenseListQuery["paymentMethod"] }))}>
      <SelectItem value="all">All Payment Methods</SelectItem><SelectItem value="cash">Cash</SelectItem><SelectItem value="card">Card</SelectItem>
    </ExpenseFilterSelect>
    <ExpenseFilterSelect label="Sort" value={query.sort} onValueChange={(value) => updateQuery((current) => ({ ...current, sort: value as ExpenseListQuery["sort"] }))}>
      <SelectItem value="newest">Newest to Oldest</SelectItem><SelectItem value="oldest">Oldest to Newest</SelectItem>
    </ExpenseFilterSelect>
    <Button className="self-end rounded-[12px] border bg-card text-row" type="button" variant="ghost" onClick={() => updateQuery(() => defaultExpenseListQuery(currentLocalMonth()))}>Clear Filters</Button>
  </>;
}

function ExpenseSearch({ query, updateQuery }: ExpenseFiltersProps) {
  return <div className="expense-search relative sm:col-span-2 lg:col-span-1">
    <span aria-hidden="true" className="expense-filter-label">Search by expense name</span>
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-[42px] size-4 text-text-muted" />
    <Input aria-label="Search expenses by name" className="rounded-[12px] pl-10 text-row" placeholder="Search by expense name" value={query.search} onChange={(event) => updateQuery((current) => ({ ...current, search: event.target.value }))} />
  </div>;
}

export function ExpenseFilters(props: ExpenseFiltersProps) {
  const phone = usePhoneLayout();

  if (!phone) return <section aria-label="Expense filters" className="expense-filter-grid mt-[26px] grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <ExpenseSearch {...props} />
    <ExpenseMonthFilter {...props} />
    <ExpenseAdditionalFilters {...props} />
  </section>;

  return <PhoneExpenseFilters {...props} />;
}

function PhoneExpenseFilters(props: ExpenseFiltersProps) {
  const [open, setOpen] = useState(false);
  return <section aria-label="Expense filters" className="expense-filter-grid journey-phone-filters">
    <ExpenseSearch {...props} />
    <div className="journey-phone-filter-toolbar">
      <ExpenseMonthFilter {...props} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild><Button type="button" variant="outline" aria-label="Filters" className="journey-phone-filter-trigger"><SlidersHorizontal aria-hidden="true" />Filters</Button></SheetTrigger>
        <SheetContent side="bottom" className="journey-phone-filter-sheet overflow-y-auto">
          <SheetHeader><SheetTitle>Filters</SheetTitle><SheetDescription>Changes filter expenses immediately.</SheetDescription></SheetHeader>
          <div className="journey-phone-filter-fields"><ExpenseMonthFilter {...props} /><ExpenseAdditionalFilters {...props} /></div>
        </SheetContent>
      </Sheet>
    </div>
  </section>;
}
