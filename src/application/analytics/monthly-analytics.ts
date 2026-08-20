import { poishaFromBigInt, type Poisha } from "@/domain/money/poisha";
import type { Expense } from "@/domain/records/domain-records";
import type { UserId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import type { SettlementRecord, SettlementStatus } from "@/domain/settlements/settlement-types";
import {
  daysInCalendarMonth,
  expenseDateIsInMonth,
  type CalendarMonth,
} from "./calendar-month";

export interface DailySpendingPoint {
  readonly day: number;
  readonly amount: Poisha;
}

export interface PaymentMixResult {
  readonly total: Poisha;
  readonly cash: Readonly<{ amount: Poisha; basisPoints?: number }>;
  readonly card: Readonly<{ amount: Poisha; basisPoints?: number }>;
}

export type MonthComparison =
  | Readonly<{ kind: "percentage"; previousTotal: Poisha; selectedTotal: Poisha; delta: Poisha; changeBasisPoints: bigint }>
  | Readonly<{ kind: "no-previous-spending"; previousTotal: Poisha; selectedTotal: Poisha; delta: Poisha }>
  | Readonly<{ kind: "no-spending-either-month"; previousTotal: Poisha; selectedTotal: Poisha; delta: Poisha }>;

export interface MemberContribution {
  readonly userId: UserId;
  readonly paid: Poisha;
  readonly share: Poisha;
}

export interface SettlementActivityBucket {
  readonly count: number;
  readonly amount: Poisha;
}

export interface SettlementActivity {
  readonly claimsCreated: SettlementActivityBucket;
  readonly confirmed: SettlementActivityBucket;
  readonly rejected: SettlementActivityBucket;
  readonly cancelled: SettlementActivityBucket;
}

function total(values: readonly number[]): Poisha {
  return poishaFromBigInt(values.reduce((sum, value) => sum + BigInt(value), BigInt(0)));
}

export function selectedMonthExpenses(
  expenses: readonly Expense[],
  month: CalendarMonth,
): readonly Expense[] {
  return expenses.filter(
    (expense) => !expense.deletedAt && expenseDateIsInMonth(expense.expenseDate, month),
  );
}

export function calculateMonthlySpending(
  expenses: readonly Expense[],
  month: CalendarMonth,
): Poisha {
  return total(selectedMonthExpenses(expenses, month).map((expense) => expense.amount));
}

export function calculateDailySpending(
  expenses: readonly Expense[],
  month: CalendarMonth,
): readonly DailySpendingPoint[] {
  const values = Array.from({ length: daysInCalendarMonth(month) }, () => BigInt(0));
  for (const expense of selectedMonthExpenses(expenses, month)) {
    values[Number(expense.expenseDate.slice(8, 10)) - 1] += BigInt(expense.amount);
  }
  return Object.freeze(values.map((amount, index) => Object.freeze({
    day: index + 1,
    amount: poishaFromBigInt(amount),
  })));
}

function paymentBasisPoints(cash: bigint, card: bigint): Readonly<{ cash: number; card: number }> {
  const combined = cash + card;
  if (combined === BigInt(0)) return { cash: 0, card: 0 };
  const cashProduct = cash * BigInt(10_000);
  const cardProduct = card * BigInt(10_000);
  let cashPoints = cashProduct / combined;
  let cardPoints = cardProduct / combined;
  const unassigned = BigInt(10_000) - cashPoints - cardPoints;
  if (unassigned > BigInt(0)) {
    const cashRemainder = cashProduct % combined;
    const cardRemainder = cardProduct % combined;
    if (cashRemainder >= cardRemainder) cashPoints += unassigned;
    else cardPoints += unassigned;
  }
  return { cash: Number(cashPoints), card: Number(cardPoints) };
}

export function calculatePaymentMix(
  expenses: readonly Expense[],
  month: CalendarMonth,
): PaymentMixResult {
  const selected = selectedMonthExpenses(expenses, month);
  const cash = total(selected.filter((expense) => expense.payment.method === "cash").map((expense) => expense.amount));
  const card = total(selected.filter((expense) => expense.payment.method === "card").map((expense) => expense.amount));
  const combined = poishaFromBigInt(BigInt(cash) + BigInt(card));
  if (combined === 0) {
    return Object.freeze({ total: combined, cash: Object.freeze({ amount: cash }), card: Object.freeze({ amount: card }) });
  }
  const basisPoints = paymentBasisPoints(BigInt(cash), BigInt(card));
  return Object.freeze({
    total: combined,
    cash: Object.freeze({ amount: cash, basisPoints: basisPoints.cash }),
    card: Object.freeze({ amount: card, basisPoints: basisPoints.card }),
  });
}

function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < BigInt(0);
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  if ((absolute % denominator) * BigInt(2) >= denominator) quotient += BigInt(1);
  return negative ? -quotient : quotient;
}

export function calculateMonthComparison(
  selectedTotal: Poisha,
  previousTotal: Poisha,
): MonthComparison {
  const delta = poishaFromBigInt(BigInt(selectedTotal) - BigInt(previousTotal));
  if (previousTotal === 0) {
    return selectedTotal === 0
      ? Object.freeze({ kind: "no-spending-either-month", previousTotal, selectedTotal, delta })
      : Object.freeze({ kind: "no-previous-spending", previousTotal, selectedTotal, delta });
  }
  const change = roundedRatio(BigInt(delta) * BigInt(10_000), BigInt(previousTotal));
  return Object.freeze({
    kind: "percentage",
    previousTotal,
    selectedTotal,
    delta,
    changeBasisPoints: change,
  });
}

export function calculateMemberContributions(
  expenses: readonly Expense[],
  month: CalendarMonth,
): readonly MemberContribution[] {
  const values = new Map<UserId, { paid: bigint; share: bigint }>();
  const get = (id: UserId) => {
    const current = values.get(id) ?? { paid: BigInt(0), share: BigInt(0) };
    values.set(id, current);
    return current;
  };
  for (const expense of selectedMonthExpenses(expenses, month)) {
    get(expense.payerId).paid += BigInt(expense.amount);
    for (const allocation of expense.allocations) {
      get(allocation.participantId).share += BigInt(allocation.share);
    }
  }
  return Object.freeze([...values.entries()].map(([userId, value]) => Object.freeze({
    userId,
    paid: poishaFromBigInt(value.paid),
    share: poishaFromBigInt(value.share),
  })));
}

function expenseDateDescending(left: Expense, right: Expense): number {
  if (left.expenseDate !== right.expenseDate) return left.expenseDate > right.expenseDate ? -1 : 1;
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
  return left.expenseId < right.expenseId ? -1 : left.expenseId > right.expenseId ? 1 : 0;
}

export function selectRecentExpenses(expenses: readonly Expense[], month: CalendarMonth): readonly Expense[] {
  return Object.freeze([...selectedMonthExpenses(expenses, month)].sort(expenseDateDescending).slice(0, 5));
}

export function selectLargestExpenses(expenses: readonly Expense[], month: CalendarMonth): readonly Expense[] {
  return Object.freeze([...selectedMonthExpenses(expenses, month)].sort((left, right) => {
    if (left.amount !== right.amount) return left.amount > right.amount ? -1 : 1;
    return expenseDateDescending(left, right);
  }).slice(0, 5));
}

function bucket(records: readonly SettlementRecord[]): SettlementActivityBucket {
  return Object.freeze({ count: records.length, amount: total(records.map((record) => record.amount)) });
}

export function calculateSettlementActivity(
  settlements: readonly SettlementRecord[],
  month: CalendarMonth,
  localMonthOfInstant: (instant: IsoInstant) => CalendarMonth,
): SettlementActivity {
  const terminal = (status: Exclude<SettlementStatus, "pending">) => settlements.filter(
    (record) => record.status === status && record.resolvedAt && localMonthOfInstant(record.resolvedAt) === month,
  );
  return Object.freeze({
    claimsCreated: bucket(settlements.filter((record) => localMonthOfInstant(record.createdAt) === month)),
    confirmed: bucket(terminal("confirmed")),
    rejected: bucket(terminal("rejected")),
    cancelled: bucket(terminal("cancelled")),
  });
}
