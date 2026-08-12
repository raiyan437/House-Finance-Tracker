import { expenseDate, type ExpenseDate } from "../dates/expense-date";
import { positivePoisha, type PositivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { userId, type UserId } from "../shared/identifiers";
import { allocateAmountSplit } from "../splits/amount-split";
import { allocateEqualSplit } from "../splits/equal-split";
import { allocatePercentageSplit } from "../splits/percentage-split";
import type {
  AmountSplitEntry,
  ExpenseAllocationPlan,
  PercentageSplitEntry,
} from "../splits/split-types";

interface ExpenseFinancialInputBase {
  readonly creatorId: UserId;
  readonly payerId: UserId;
  readonly expenseAmount: PositivePoisha;
  readonly expenseDate: ExpenseDate;
  readonly participantIds: readonly UserId[];
}

export interface EqualExpenseFinancialInput extends ExpenseFinancialInputBase {
  readonly split: { readonly method: "equal" };
}

export interface AmountExpenseFinancialInput extends ExpenseFinancialInputBase {
  readonly split: {
    readonly method: "amount";
    readonly entries: readonly AmountSplitEntry[];
  };
}

export interface PercentageExpenseFinancialInput
  extends ExpenseFinancialInputBase {
  readonly split: {
    readonly method: "percentage";
    readonly entries: readonly PercentageSplitEntry[];
  };
}

export type ExpenseFinancialInput =
  | EqualExpenseFinancialInput
  | AmountExpenseFinancialInput
  | PercentageExpenseFinancialInput;

export function allocateExpense(
  input: ExpenseFinancialInput,
): ExpenseAllocationPlan {
  userId(input.creatorId);
  userId(input.payerId);
  positivePoisha(input.expenseAmount);
  expenseDate(input.expenseDate);

  if (input.creatorId !== input.payerId) {
    throw new DomainError(
      "PAYER_CREATOR_MISMATCH",
      "The payer must be the current user creating the expense.",
    );
  }

  switch (input.split.method) {
    case "equal":
      return {
        expenseAmount: input.expenseAmount,
        method: "equal",
        allocations: allocateEqualSplit(
          input.expenseAmount,
          input.participantIds,
        ),
      };
    case "amount":
      return {
        expenseAmount: input.expenseAmount,
        method: "amount",
        allocations: allocateAmountSplit(
          input.expenseAmount,
          input.participantIds,
          input.split.entries,
        ),
      };
    case "percentage":
      return {
        expenseAmount: input.expenseAmount,
        method: "percentage",
        allocations: allocatePercentageSplit(
          input.expenseAmount,
          input.participantIds,
          input.split.entries,
        ),
      };
  }
}
