import type { BasisPoints } from "../money/basis-points";
import type { Poisha, PositivePoisha } from "../money/poisha";
import type { UserId } from "../shared/identifiers";

export type SplitMethod = "equal" | "amount" | "percentage";

export interface SplitAllocation {
  readonly participantId: UserId;
  readonly share: Poisha;
}
export interface AmountSplitEntry {
  readonly participantId: UserId;
  readonly amount: Poisha;
}

export interface PercentageSplitEntry {
  readonly participantId: UserId;
  readonly basisPoints: BasisPoints;
}

export interface ExpenseAllocationPlan {
  readonly expenseAmount: PositivePoisha;
  readonly method: SplitMethod;
  readonly allocations: readonly SplitAllocation[];
}
