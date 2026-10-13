"use client";

import Link from "next/link";
import { Loader2, ShieldCheck } from "lucide-react";
import {
  previewExpenseDraft,
  type ExpenseFormDraft,
} from "@/application/expenses/expense-form";
import type { ExpenseView } from "@/application/services/application-services";
import { Button } from "@/components/ui/button";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { Surface } from "@/presentation/components/surface";
import { CapabilityNotice } from "@/presentation/runtime/capability-gate.client";
import type { RefObject } from "react";

interface ExpenseSummarySectionProps {
  readonly preview: ReturnType<typeof previewExpenseDraft>;
  readonly draft: ExpenseFormDraft;
  readonly financialLocked: boolean;
  readonly allocationStatus: string;
  readonly submitError: string | undefined;
  readonly submitErrorRef: RefObject<HTMLDivElement | null>;
  readonly original: ExpenseView | undefined;
  readonly pendingSave: boolean;
  readonly saveDisabled: boolean;
  readonly mode: "create" | "edit";
}

export function ExpenseSummarySection({
  preview,
  draft,
  financialLocked,
  allocationStatus,
  submitError,
  submitErrorRef,
  original,
  pendingSave,
  saveDisabled,
  mode,
}: ExpenseSummarySectionProps) {
  return (
    <aside
      aria-label="Expense summary and actions"
      className="journey-expense-summary flex self-stretch flex-col gap-4"
    >
      <Surface elevation="card" padding="canonical">
        <h2 className="panel-title">Summary</h2>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">Expense Total</dt>
            <dd className="font-semibold tabular-nums">
              {preview.amount ? formatBdt(preview.amount) : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">Allocated</dt>
            <dd className="tabular-nums">
              {preview.allocated !== undefined
                ? formatBdt(preview.allocated)
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">Your Share</dt>
            <dd className="tabular-nums">{formatBdt(preview.yourShare)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">Participants</dt>
            <dd>{preview.participantCount}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-text-secondary">Payment Method</dt>
            <dd className="capitalize">{draft.paymentMethod}</dd>
          </div>
          <div className="border-t pt-3">
            <dt className="text-text-secondary">Allocation Status</dt>
            <dd
              className={
                preview.canPersist || financialLocked
                  ? "mt-1 font-medium text-success"
                  : "mt-1 font-medium text-warning"
              }
            >
              {financialLocked
                ? "Financial history preserved"
                : allocationStatus}
            </dd>
          </div>
        </dl>
        {submitError ? (
          <div
            className="mt-5 rounded-lg bg-danger-soft p-3 text-sm text-danger"
            role="alert"
            tabIndex={-1}
            ref={submitErrorRef}
          >
            {submitError}
          </div>
        ) : null}
      </Surface>
      <Surface className="min-h-[104px]" padding="canonical">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft">
            <ShieldCheck aria-hidden="true" className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Privacy Note</h2>
            <p className="compact-caption mt-1 text-text-muted">
              Private Card details remain visible only to the Card owner.
            </p>
          </div>
        </div>
      </Surface>
      <div className="mt-auto grid gap-3">
        <div className="grid grid-cols-[116px_minmax(0,1fr)] gap-3">
          <Button type="button" variant="outline" asChild>
            <Link
              href={
                original
                  ? `/expenses/${original.expense.expenseId}`
                  : "/expenses"
              }
            >
              Cancel
            </Link>
          </Button>
          <Button
            aria-busy={pendingSave}
            disabled={pendingSave || saveDisabled}
            type="submit"
          >
            {pendingSave ? (
              <>
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />{" "}
                Saving…
              </>
            ) : mode === "create" ? (
              "Create Expense"
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
        <CapabilityNotice active={saveDisabled} />
      </div>
    </aside>
  );
}
