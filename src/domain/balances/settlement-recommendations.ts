import { positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { compareUserIds } from "../shared/identifiers";
import type { SettlementRecommendation } from "../settlements/settlement-types";
import { assertHouseholdBalanceSheet } from "./balance-invariants";
import type { HouseholdBalanceSheet, MemberBalance } from "./balance-types";

interface WorkingBalance {
  readonly member: MemberBalance;
  amount: bigint;
}

export function generateSettlementRecommendations(
  sheet: HouseholdBalanceSheet,
): readonly SettlementRecommendation[] {
  assertHouseholdBalanceSheet(sheet.householdId, sheet);

  const debtors: WorkingBalance[] = sheet.balances
    .filter((member) => member.balance < 0)
    .map((member) => ({ member, amount: -BigInt(member.balance) }));
  const creditors: WorkingBalance[] = sheet.balances
    .filter((member) => member.balance > 0)
    .map((member) => ({ member, amount: BigInt(member.balance) }));
  const recommendations: SettlementRecommendation[] = [];

  const rank = (left: WorkingBalance, right: WorkingBalance): number => {
    if (left.amount > right.amount) return -1;
    if (left.amount < right.amount) return 1;
    return compareUserIds(left.member.memberId, right.member.memberId);
  };

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(rank);
    creditors.sort(rank);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;

    recommendations.push(
      Object.freeze({
        householdId: sheet.householdId,
        senderId: debtor.member.memberId,
        receiverId: creditor.member.memberId,
        amount: positivePoisha(Number(amount)),
      }),
    );

    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === BigInt(0)) debtors.shift();
    if (creditor.amount === BigInt(0)) creditors.shift();
  }

  if (debtors.length !== 0 || creditors.length !== 0) {
    throw new DomainError(
      "BALANCE_SHEET_NOT_ZERO_SUM",
      "Recommendations could not resolve the supplied balance sheet.",
    );
  }

  return Object.freeze(recommendations);
}
