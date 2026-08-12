import type { PositivePoisha } from "../money/poisha";
import type {
  ExpenseId,
  HouseholdId,
  UserId,
} from "../shared/identifiers";
import type { SplitAllocation } from "../splits/split-types";

export interface BalanceExpense {
  readonly expenseId: ExpenseId;
  readonly householdId: HouseholdId;
  readonly payerId: UserId;
  readonly amount: PositivePoisha;
  readonly allocations: readonly SplitAllocation[];
  readonly deleted: boolean;
}
