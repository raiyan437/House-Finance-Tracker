import type { Poisha } from "../money/poisha";
import type { HouseholdId, UserId } from "../shared/identifiers";

export interface MemberBalance {
  readonly householdId: HouseholdId;
  readonly memberId: UserId;
  readonly balance: Poisha;
}

export interface HouseholdBalanceSheet {
  readonly householdId: HouseholdId;
  readonly balances: readonly MemberBalance[];
  readonly totalCreditorValue: Poisha;
  readonly totalDebtorMagnitude: Poisha;
}
