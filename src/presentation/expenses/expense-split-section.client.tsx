"use client";

import { Check } from "lucide-react";
import {
  previewExpenseDraft,
  type ExpenseFormDraft,
} from "@/application/expenses/expense-form";
import { type ExpenseFormValues } from "@/application/validation/expense-form.schema";
import type {
  ExpenseMemberView,
  ExpenseView,
} from "@/application/services/application-services";
import { Input } from "@/components/ui/input";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { Surface } from "@/presentation/components/surface";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import type { UseFormReturn } from "react-hook-form";

interface ExpenseSplitSectionProps {
  readonly financialLocked: boolean;
  readonly members: readonly ExpenseMemberView[];
  readonly draft: ExpenseFormDraft;
  readonly toggleParticipant: (id: string, checked: boolean) => void;
  readonly currentUserId: string | undefined;
  readonly participantsIssue: string | undefined;
  readonly form: UseFormReturn<ExpenseFormValues>;
  readonly original: ExpenseView | undefined;
  readonly memberById: ReadonlyMap<string, ExpenseMemberView>;
  readonly preview: ReturnType<typeof previewExpenseDraft>;
  readonly splitEntryWasInteractedWith: (
    method: "amount" | "percentage",
    id: string,
  ) => boolean;
  readonly splitIssue: string | undefined;
}

export function ExpenseSplitSection({
  financialLocked,
  members,
  draft,
  toggleParticipant,
  currentUserId,
  participantsIssue,
  form,
  original,
  memberById,
  preview,
  splitEntryWasInteractedWith,
  splitIssue,
}: ExpenseSplitSectionProps) {
  return (
    <Surface
      className="split-expense-panel order-3 space-y-3"
      padding="canonical"
    >
      <h2 className="panel-title">Split Expense</h2>
      <fieldset id="expense-participants" disabled={financialLocked}>
        <legend className="text-label font-medium">Participants</legend>
        <p className="mt-1 text-sm text-text-secondary">
          Select at least one household member. You may exclude yourself.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {members
            .filter(
              (member) =>
                member.status === "active" ||
                draft.participantIds.includes(member.userId),
            )
            .map((member) => {
              const selected = draft.participantIds.includes(member.userId);
              return (
                <label
                  key={member.userId}
                  className={`relative flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 focus-within:ring-3 focus-within:ring-ring/30 ${selected ? "border-foreground bg-secondary" : "bg-card"}`}
                >
                  <input
                    className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      toggleParticipant(member.userId, event.target.checked)
                    }
                  />
                  <MemberAvatar
                    className="size-7 [&_[data-slot=avatar-fallback]]:text-[9px]"
                    displayName={member.displayName}
                    userId={member.userId}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {member.userId === currentUserId
                      ? "You"
                      : member.displayName}
                    {member.status === "former" ? " (Former member)" : ""}
                  </span>
                  {selected ? (
                    <Check aria-hidden="true" className="size-4" />
                  ) : null}
                </label>
              );
            })}
        </div>
        {participantsIssue ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {participantsIssue}
          </p>
        ) : null}
      </fieldset>
      <fieldset id="expense-split-method" disabled={financialLocked}>
        <legend className="sr-only">Split Method</legend>
        <div className="grid grid-cols-3 rounded-xl bg-secondary p-1">
          {(["equal", "amount", "percentage"] as const).map((method) => (
            <label
              key={method}
              className={`relative flex h-9 cursor-pointer items-center justify-center rounded-lg text-xs font-medium capitalize focus-within:ring-3 focus-within:ring-ring/30 ${draft.splitMethod === method ? "bg-card shadow-[var(--shadow-small)]" : "text-text-secondary"}`}
            >
              <input
                className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                type="radio"
                value={method}
                {...form.register("splitMethod")}
              />{" "}
              {method}
            </label>
          ))}
        </div>
      </fieldset>
      {original?.percentageSourceStatus ===
      "legacy-percentage-input-unavailable" ? (
        <p className="rounded-lg bg-warning-soft p-3 text-sm" role="status">
          Original percentage inputs are unavailable. No percentages have been
          inferred from the saved poisha shares.
        </p>
      ) : null}
      <div className="journey-split-allocations grid gap-2 sm:grid-cols-3">
        {draft.participantIds.map((id) => {
          const member = memberById.get(id);
          const allocation = preview.allocations.find(
            (item) => item.participantId === id,
          );
          const entryIssue =
            draft.splitMethod === "equal" ||
            !splitEntryWasInteractedWith(draft.splitMethod, id)
              ? undefined
              : preview.issues[`${draft.splitMethod}:${id}`];
          const inputId = `expense-${draft.splitMethod}-share-${id}`;
          return (
            <div
              key={id}
              className="grid items-center gap-1 rounded-xl border p-3"
            >
              <span className="truncate text-xs font-medium">
                {id === currentUserId
                  ? "You"
                  : (member?.displayName ?? "Member")}
              </span>
              {draft.splitMethod === "amount" ? (
                <Input
                  id={inputId}
                  className="h-9"
                  disabled={financialLocked}
                  inputMode="decimal"
                  aria-label={`Amount share for ${member?.displayName ?? id}`}
                  aria-invalid={Boolean(entryIssue)}
                  aria-describedby={entryIssue ? `${inputId}-error` : undefined}
                  value={draft.amountTextByParticipant[id] ?? ""}
                  onChange={(event) =>
                    form.setValue(
                      `amountTextByParticipant.${id}`,
                      event.target.value,
                      { shouldDirty: true },
                    )
                  }
                  onBlur={() =>
                    form.setValue(
                      `amountTextByParticipant.${id}`,
                      draft.amountTextByParticipant[id] ?? "",
                      { shouldTouch: true, shouldValidate: true },
                    )
                  }
                />
              ) : draft.splitMethod === "percentage" ? (
                <div className="relative">
                  <Input
                    id={inputId}
                    disabled={financialLocked}
                    inputMode="decimal"
                    aria-label={`Percentage share for ${member?.displayName ?? id}`}
                    aria-invalid={Boolean(entryIssue)}
                    aria-describedby={
                      entryIssue ? `${inputId}-error` : undefined
                    }
                    className="h-9 pr-8"
                    value={draft.percentageTextByParticipant[id] ?? ""}
                    onChange={(event) =>
                      form.setValue(
                        `percentageTextByParticipant.${id}`,
                        event.target.value,
                        { shouldDirty: true },
                      )
                    }
                    onBlur={() =>
                      form.setValue(
                        `percentageTextByParticipant.${id}`,
                        draft.percentageTextByParticipant[id] ?? "",
                        { shouldTouch: true, shouldValidate: true },
                      )
                    }
                  />
                  <span className="absolute right-3 top-2 text-text-muted">
                    %
                  </span>
                </div>
              ) : (
                <span className="text-fine text-text-muted">
                  Calculated equally
                </span>
              )}
              <span className="financial-numerals text-xs font-semibold">
                {allocation ? formatBdt(allocation.share) : "—"}
                {preview.provisional && draft.splitMethod === "percentage" ? (
                  <small className="block text-warning">Provisional</small>
                ) : null}
              </span>
              {entryIssue ? (
                <p id={`${inputId}-error`} className="text-caption text-danger">
                  {entryIssue}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {splitIssue ? (
        <p className="text-sm text-danger" role="alert">
          {splitIssue}
        </p>
      ) : null}
    </Surface>
  );
}
