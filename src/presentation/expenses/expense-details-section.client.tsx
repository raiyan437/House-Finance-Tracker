"use client";

import Link from "next/link";
import { Banknote, Check, CreditCard } from "lucide-react";
import { type ExpenseFormDraft } from "@/application/expenses/expense-form";
import { type ExpenseFormValues } from "@/application/validation/expense-form.schema";
import type { ExpenseView } from "@/application/services/application-services";
import type { MyCardSummaryView } from "@/application/cards/card-page";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Surface } from "@/presentation/components/surface";
import { ExpenseIconGraphic, EXPENSE_ICON_OPTIONS } from "./expense-icon";
import type { Dispatch, SetStateAction } from "react";
import type { UseFormReturn } from "react-hook-form";

interface ExpenseDetailsSectionProps {
  readonly nameIssue: string | undefined;
  readonly form: UseFormReturn<ExpenseFormValues>;
  readonly values: Readonly<{
    iconCategory?: ExpenseFormValues["iconCategory"];
    expenseDateText?: string;
    selectedCardId?: string;
  }>;
  readonly financialLocked: boolean;
  readonly amountIssue: string | undefined;
  readonly earliestExpenseDate: string | undefined;
  readonly businessDate: string;
  readonly dateIssue: string | undefined;
  readonly payerName: string;
  readonly original: ExpenseView | undefined;
  readonly ownerEditing: boolean;
  readonly draft: ExpenseFormDraft;
  readonly mode: "create" | "edit";
  readonly cards: readonly MyCardSummaryView[];
  readonly confirmCardToCash: boolean;
  readonly setConfirmCardToCash: Dispatch<SetStateAction<boolean>>;
}

export function ExpenseDetailsSection({
  nameIssue,
  form,
  values,
  financialLocked,
  amountIssue,
  earliestExpenseDate,
  businessDate,
  dateIssue,
  payerName,
  original,
  ownerEditing,
  draft,
  mode,
  cards,
  confirmCardToCash,
  setConfirmCardToCash,
}: ExpenseDetailsSectionProps) {
  return (
    <Surface
      className="expense-details-panel order-1 space-y-3"
      padding="canonical"
    >
      <h2 className="panel-title">Expense Details</h2>
      <div className="expense-details-fields grid gap-3 sm:grid-cols-2">
        <div className="expense-name-field space-y-2 sm:col-span-2">
          <Label htmlFor="expense-name">Expense Name</Label>
          <Input
            id="expense-name"
            aria-invalid={Boolean(nameIssue)}
            aria-describedby={nameIssue ? "expense-name-error" : undefined}
            {...form.register("name")}
          />
          {nameIssue ? (
            <p id="expense-name-error" className="text-caption text-danger">
              {nameIssue}
            </p>
          ) : null}
        </div>
        <fieldset className="expense-category-field min-w-0 sm:col-span-2">
          <legend className="text-label font-medium">Expense Category</legend>
          <TooltipProvider delayDuration={300}>
            <div
              className="mt-2 w-full max-w-full overflow-x-auto overscroll-x-contain pb-1"
              data-testid="expense-category-scroll-strip"
            >
              <div className="flex w-max flex-nowrap gap-2 p-1">
                {EXPENSE_ICON_OPTIONS.map(({ value, label }) => {
                  const selected = values.iconCategory === value;
                  return (
                    <Tooltip key={value}>
                      <TooltipTrigger asChild>
                        <label
                          title={label}
                          className={`relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors focus-within:ring-3 focus-within:ring-ring/30 ${selected ? "border-foreground bg-brand-soft text-foreground shadow-[inset_0_0_0_1px_var(--foreground)]" : "bg-card text-text-secondary hover:bg-secondary"}`}
                        >
                          <input
                            aria-label={label}
                            className="absolute inset-0 size-full cursor-pointer opacity-0"
                            type="radio"
                            value={value}
                            {...form.register("iconCategory")}
                          />
                          <ExpenseIconGraphic
                            category={value}
                            className="size-6"
                          />
                          {selected ? (
                            <span
                              aria-hidden="true"
                              className="absolute right-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-full bg-foreground text-background"
                            >
                              <Check className="size-2.5" />
                            </span>
                          ) : null}
                        </label>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={6}>{label}</TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </TooltipProvider>
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="expense-amount">Amount (BDT)</Label>
          <Input
            id="expense-amount"
            inputMode="decimal"
            disabled={financialLocked}
            aria-invalid={Boolean(amountIssue)}
            aria-describedby={amountIssue ? "expense-amount-error" : undefined}
            {...form.register("amountText")}
          />
          {amountIssue ? (
            <p id="expense-amount-error" className="text-caption text-danger">
              {amountIssue}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="expense-date">Expense Date</Label>
          <DatePicker
            id="expense-date"
            disabled={financialLocked}
            min={earliestExpenseDate}
            max={businessDate || undefined}
            invalid={Boolean(dateIssue)}
            aria-describedby={dateIssue ? "expense-date-error" : undefined}
            value={values.expenseDateText}
            onChange={(value) =>
              form.setValue("expenseDateText", value, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              })
            }
          />
          {dateIssue ? (
            <p id="expense-date-error" className="text-caption text-danger">
              {dateIssue}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>Paid By</Label>
          <div className="flex h-11 items-center rounded-md border bg-secondary px-3 text-sm">
            {payerName}
          </div>
        </div>
      </div>
      <fieldset
        disabled={
          financialLocked ||
          (Boolean(original) &&
            !ownerEditing &&
            original?.expense.payment.method === "cash")
        }
      >
        <legend className="text-label font-medium">Payment Method</legend>
        <div className="mt-2 grid grid-cols-2 rounded-xl bg-secondary p-1">
          {(["cash", "card"] as const).map((method) => (
            <label
              key={method}
              className={`relative flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-medium focus-within:ring-3 focus-within:ring-ring/30 ${draft.paymentMethod === method ? "bg-card shadow-[var(--shadow-small)]" : "text-text-secondary"}`}
            >
              <input
                className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                type="radio"
                value={method}
                {...form.register("paymentMethod")}
              />
              {method === "cash" ? (
                <Banknote aria-hidden="true" className="size-4" />
              ) : (
                <CreditCard aria-hidden="true" className="size-4" />
              )}
              <span className="capitalize">{method}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {draft.paymentMethod === "card" ? (
        ownerEditing || mode === "create" ? (
          <div className="space-y-2">
            <Label htmlFor="expense-card">Your Card</Label>
            <Select
              disabled={
                financialLocked ||
                (cards.length === 0 && !original?.privateCardSnapshot)
              }
              value={values.selectedCardId || undefined}
              onValueChange={(value) =>
                form.setValue("selectedCardId", value, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger id="expense-card" aria-label="Your Card">
                <SelectValue
                  placeholder={
                    cards.length ? "Select a Card" : "No cards available"
                  }
                />
              </SelectTrigger>
              <SelectContent align="start">
                {original?.privateCardSnapshot &&
                !cards.some(
                  (card) =>
                    card.cardId === original.privateCardSnapshot?.cardId,
                ) ? (
                  <SelectItem value={original.privateCardSnapshot.cardId}>
                    Keep {original.privateCardSnapshot.cardName} (archived)
                  </SelectItem>
                ) : null}
                {cards.map((card) => (
                  <SelectItem key={card.cardId} value={card.cardId}>
                    {card.name} · {card.type === "debit" ? "Debit" : "Credit"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cards.length === 0 && !original?.privateCardSnapshot ? (
              <p className="text-sm text-text-secondary">
                No cards available.{" "}
                <Link
                  className="font-medium text-foreground underline underline-offset-4"
                  href="/cards"
                >
                  Add a private Card label in My Cards
                </Link>
                , or use Cash.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            The existing private Card association will be preserved opaquely.
          </p>
        )
      ) : null}
      {original?.expense.payment.method === "card" &&
      draft.paymentMethod === "cash" ? (
        <label className="flex min-h-11 items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-3">
          <input
            className="mt-1"
            type="checkbox"
            checked={confirmCardToCash}
            onChange={(event) => setConfirmCardToCash(event.target.checked)}
          />
          <span>
            Confirm changing the current Payment Method from Card to Cash.
          </span>
        </label>
      ) : null}
    </Surface>
  );
}
