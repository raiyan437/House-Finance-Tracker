import type { BalanceExpense } from "../expenses/balance-expense";
import type { Poisha } from "../money/poisha";
import { poisha, positivePoisha } from "../money/poisha";
import { canonicalMemberships } from "../membership/membership-invariants";
import type { MembershipSnapshot } from "../membership/membership-types";
import { DomainError } from "../shared/domain-error";
import {
  expenseId,
  householdId,
  userId,
  type HouseholdId,
  type UserId,
} from "../shared/identifiers";
import type { SettlementRecord } from "../settlements/settlement-types";
import { assertSettlementRecord } from "../settlements/settlement-invariants";
import { assertCompleteAllocation } from "../splits/split-invariants";
import type { HouseholdBalanceSheet, MemberBalance } from "./balance-types";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);

function balancePoisha(value: bigint): Poisha {
  if (value < MIN_SAFE || value > MAX_SAFE) {
    throw new DomainError(
      "BALANCE_OVERFLOW",
      "A calculated balance exceeds the safe integer poisha range.",
    );
  }
  return poisha(Number(value));
}

function requireKnownMember(
  memberIds: ReadonlySet<UserId>,
  memberId: UserId,
): void {
  userId(memberId);
  if (!memberIds.has(memberId)) {
    throw new DomainError(
      "UNKNOWN_BALANCE_MEMBER",
      "A ledger entry references a user outside the household history.",
    );
  }
}

export function calculateHouseholdBalances(
  household: HouseholdId,
  memberships: readonly MembershipSnapshot[],
  expenses: readonly BalanceExpense[],
  settlements: readonly SettlementRecord[],
): HouseholdBalanceSheet {
  householdId(household);
  const canonicalMembers = canonicalMemberships(household, memberships);
  const memberIds = new Set(canonicalMembers.map((member) => member.userId));
  const working = new Map<UserId, bigint>(
    canonicalMembers.map((member) => [member.userId, BigInt(0)]),
  );

  for (const expense of expenses) {
    expenseId(expense.expenseId);
    householdId(expense.householdId);
    if (expense.householdId !== household) {
      throw new DomainError(
        "INVALID_EXPENSE_LEDGER_ENTRY",
        "An expense ledger entry belongs to another household.",
      );
    }
    requireKnownMember(memberIds, expense.payerId);
    positivePoisha(expense.amount);
    const participantIds = expense.allocations.map(
      (allocation) => allocation.participantId,
    );
    participantIds.forEach((participantId) =>
      requireKnownMember(memberIds, participantId),
    );
    assertCompleteAllocation(expense.amount, participantIds, expense.allocations);

    if (expense.deleted) continue;

    working.set(
      expense.payerId,
      (working.get(expense.payerId) ?? BigInt(0)) + BigInt(expense.amount),
    );
    for (const allocation of expense.allocations) {
      working.set(
        allocation.participantId,
        (working.get(allocation.participantId) ?? BigInt(0)) -
          BigInt(allocation.share),
      );
    }
  }

  for (const settlement of settlements) {
    assertSettlementRecord(settlement);
    if (settlement.householdId !== household) {
      throw new DomainError(
        "INVALID_SETTLEMENT_PARTIES",
        "A settlement ledger entry belongs to another household.",
      );
    }
    requireKnownMember(memberIds, settlement.senderId);
    requireKnownMember(memberIds, settlement.receiverId);
    if (settlement.senderId === settlement.receiverId) {
      throw new DomainError(
        "INVALID_SETTLEMENT_PARTIES",
        "A settlement sender and receiver must be different members.",
      );
    }
    positivePoisha(settlement.amount);

    if (settlement.status !== "confirmed") continue;

    working.set(
      settlement.senderId,
      (working.get(settlement.senderId) ?? BigInt(0)) +
        BigInt(settlement.amount),
    );
    working.set(
      settlement.receiverId,
      (working.get(settlement.receiverId) ?? BigInt(0)) -
        BigInt(settlement.amount),
    );
  }

  const balances: MemberBalance[] = canonicalMembers.map((member) => ({
    householdId: household,
    memberId: member.userId,
    balance: balancePoisha(working.get(member.userId) ?? BigInt(0)),
  }));
  const total = balances.reduce(
    (sum, member) => sum + BigInt(member.balance),
    BigInt(0),
  );
  if (total !== BigInt(0)) {
    throw new DomainError(
      "BALANCE_SHEET_NOT_ZERO_SUM",
      "A household balance sheet must sum exactly to zero.",
    );
  }

  const creditorTotal = balances.reduce(
    (sum, member) =>
      member.balance > 0 ? sum + BigInt(member.balance) : sum,
    BigInt(0),
  );
  const debtorTotal = balances.reduce(
    (sum, member) =>
      member.balance < 0 ? sum - BigInt(member.balance) : sum,
    BigInt(0),
  );

  if (creditorTotal !== debtorTotal) {
    throw new DomainError(
      "BALANCE_SHEET_NOT_ZERO_SUM",
      "Total creditor value must equal total debtor magnitude.",
    );
  }

  return Object.freeze({
    householdId: household,
    balances: Object.freeze(balances.map((balance) => Object.freeze(balance))),
    totalCreditorValue: balancePoisha(creditorTotal),
    totalDebtorMagnitude: balancePoisha(debtorTotal),
  });
}
