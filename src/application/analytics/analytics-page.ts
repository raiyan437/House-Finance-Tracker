import { ApplicationError } from "@/application/errors/application-error";
import type { HouseholdBalanceSheet } from "@/domain/balances/balance-types";
import { hasPendingSettlementForPair } from "@/domain/settlements/pending-settlement-policy";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { poisha, poishaFromBigInt, type Poisha } from "@/domain/money/poisha";
import type { Expense, MemberIdentityView } from "@/domain/records/domain-records";
import { compareUserIds, type HouseholdId, type UserId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import type { SettlementRecommendation, SettlementRecord } from "@/domain/settlements/settlement-types";
import {
  calendarMonth,
  compareCalendarMonths,
  previousCalendarMonth,
  type CalendarMonth,
} from "./calendar-month";
import {
  calculateDailySpending,
  calculateMemberContributions,
  calculateMonthComparison,
  calculateMonthlySpending,
  calculatePaymentMix,
  calculateSettlementActivity,
  selectLargestExpenses,
  selectRecentExpenses,
  selectedMonthExpenses,
  type DailySpendingPoint,
  type MonthComparison,
  type PaymentMixResult,
  type SettlementActivity,
} from "./monthly-analytics";

export interface AnalyticsMemberView {
  readonly userId: UserId;
  readonly displayName: string;
  readonly isCurrentUser: boolean;
  readonly isFormerMember: boolean;
}

export interface AnalyticsExpenseView {
  readonly expenseId: Expense["expenseId"];
  readonly name: string;
  readonly amount: Poisha;
  readonly expenseDate: Expense["expenseDate"];
  readonly createdAt: IsoInstant;
  readonly payer: AnalyticsMemberView;
  readonly paymentMethod: "cash" | "card";
}

export interface HousemateBalanceView extends AnalyticsMemberView {
  readonly balance: Poisha;
  readonly state: "gets-back" | "owes" | "settled";
}

export interface DashboardMemberContributionView extends AnalyticsMemberView {
  readonly paid: Poisha;
}

export interface DashboardPageView {
  readonly selectedMonth: CalendarMonth;
  readonly monthOptions: readonly CalendarMonth[];
  readonly members: readonly AnalyticsMemberView[];
  readonly spent: Poisha;
  readonly outstanding: Readonly<{ youOwe: Poisha; youAreOwed: Poisha }>;
  readonly settlementHealth: Readonly<{ outstandingCount: number; pendingCount: number }>;
  readonly memberContributions: readonly DashboardMemberContributionView[];
  readonly dailySpending: readonly DailySpendingPoint[];
  readonly paymentMix: PaymentMixResult;
  readonly housemateBalances: readonly HousemateBalanceView[];
  readonly recentExpenses: readonly AnalyticsExpenseView[];
}

export interface MonthlyReportMemberView extends AnalyticsMemberView {
  readonly paid: Poisha;
  readonly share: Poisha;
}

export interface MonthlyReportPageView {
  readonly selectedMonth: CalendarMonth;
  readonly monthOptions: readonly CalendarMonth[];
  readonly totalSpending: Poisha;
  readonly expenseCount: number;
  readonly comparison: MonthComparison;
  readonly dailySpending: readonly DailySpendingPoint[];
  readonly paymentMix: PaymentMixResult;
  readonly members: readonly MonthlyReportMemberView[];
  readonly largestExpenses: readonly AnalyticsExpenseView[];
  readonly settlementActivity: SettlementActivity;
  readonly currentOutstanding: Readonly<{ count: number; total: Poisha }>;
}

export interface AnalyticsSourceSnapshot {
  readonly householdId: HouseholdId;
  readonly actorId: UserId;
  readonly memberships: readonly MembershipSnapshot[];
  readonly profiles: readonly MemberIdentityView[];
  readonly expenses: readonly Expense[];
  readonly settlements: readonly SettlementRecord[];
  readonly sheet: HouseholdBalanceSheet;
  readonly recommendations: readonly SettlementRecommendation[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function profileMap(source: AnalyticsSourceSnapshot): Map<UserId, MemberIdentityView> {
  return new Map(source.profiles.map((profile) => [profile.userId, profile]));
}

function membershipMap(source: AnalyticsSourceSnapshot): Map<UserId, MembershipSnapshot> {
  return new Map(source.memberships.map((membership) => [membership.userId, membership]));
}

function memberView(
  source: AnalyticsSourceSnapshot,
  userId: UserId,
  profiles = profileMap(source),
  memberships = membershipMap(source),
): AnalyticsMemberView {
  const profile = profiles.get(userId);
  const membership = memberships.get(userId);
  if (!profile || !membership) {
    throw new ApplicationError("MALFORMED_PERSISTED_DATA", "An analytics member identity is unavailable.");
  }
  return Object.freeze({
    userId,
    displayName: profile.displayName,
    isCurrentUser: userId === source.actorId,
    isFormerMember: membership.status === "former",
  });
}

function activeMembers(source: AnalyticsSourceSnapshot): readonly AnalyticsMemberView[] {
  const profiles = profileMap(source);
  const memberships = membershipMap(source);
  return Object.freeze(source.memberships
    .filter((membership) => membership.status === "active")
    .map((membership) => ({ membership, member: memberView(source, membership.userId, profiles, memberships) }))
    .sort((left, right) => {
      if (left.membership.role !== right.membership.role) return left.membership.role === "leader" ? -1 : 1;
      return compareText(left.member.displayName, right.member.displayName) || compareUserIds(left.member.userId, right.member.userId);
    })
    .map((entry) => entry.member));
}

function expenseView(source: AnalyticsSourceSnapshot, expense: Expense): AnalyticsExpenseView {
  return Object.freeze({
    expenseId: expense.expenseId,
    name: expense.name,
    amount: poisha(expense.amount),
    expenseDate: expense.expenseDate,
    createdAt: expense.createdAt,
    payer: memberView(source, expense.payerId),
    paymentMethod: expense.payment.method,
  });
}

function monthOptions(
  source: AnalyticsSourceSnapshot,
  selectedMonth: CalendarMonth,
  currentMonth?: CalendarMonth,
  localMonthOfInstant?: (instant: IsoInstant) => CalendarMonth,
): readonly CalendarMonth[] {
  const values = new Set<CalendarMonth>([selectedMonth]);
  if (currentMonth) values.add(currentMonth);
  for (const expense of source.expenses) {
    if (!expense.deletedAt) values.add(calendarMonth(expense.expenseDate.slice(0, 7)));
  }
  if (localMonthOfInstant) {
    for (const settlement of source.settlements) {
      values.add(localMonthOfInstant(settlement.createdAt));
      if (settlement.resolvedAt) values.add(localMonthOfInstant(settlement.resolvedAt));
    }
  }
  return Object.freeze([...values].sort((left, right) => compareCalendarMonths(right, left)));
}

function viewerOutstanding(source: AnalyticsSourceSnapshot): Readonly<{ youOwe: Poisha; youAreOwed: Poisha }> {
  const balance = source.sheet.balances.find((entry) => entry.memberId === source.actorId)?.balance;
  if (balance === undefined) {
    throw new ApplicationError("MALFORMED_PERSISTED_DATA", "The current member balance is unavailable.");
  }
  return Object.freeze({
    youOwe: balance < 0 ? poisha(-balance) : poisha(0),
    youAreOwed: balance > 0 ? balance : poisha(0),
  });
}

function settlementHealth(source: AnalyticsSourceSnapshot): Readonly<{ outstandingCount: number; pendingCount: number }> {
  const pendingCount = source.settlements.filter((settlement) => settlement.status === "pending").length;
  const outstandingCount = source.recommendations.filter((recommendation) => !hasPendingSettlementForPair(
    source.householdId,
    recommendation.senderId,
    recommendation.receiverId,
    source.settlements,
  )).length;
  return Object.freeze({ outstandingCount, pendingCount });
}

function housemateBalances(source: AnalyticsSourceSnapshot): readonly HousemateBalanceView[] {
  const active = activeMembers(source);
  const values = active.map((member): HousemateBalanceView => {
    const balance = source.sheet.balances.find((entry) => entry.memberId === member.userId)?.balance;
    if (balance === undefined) throw new ApplicationError("MALFORMED_PERSISTED_DATA", "An active member balance is unavailable.");
    return Object.freeze({
      ...member,
      balance,
      state: balance > 0 ? "gets-back" : balance < 0 ? "owes" : "settled",
    });
  });
  const stateRank = { "gets-back": 0, owes: 1, settled: 2 } as const;
  return Object.freeze(values.sort((left, right) => {
    if (left.isCurrentUser !== right.isCurrentUser) return left.isCurrentUser ? -1 : 1;
    if (left.state !== right.state) return stateRank[left.state] - stateRank[right.state];
    const leftMagnitude = left.balance < 0 ? -BigInt(left.balance) : BigInt(left.balance);
    const rightMagnitude = right.balance < 0 ? -BigInt(right.balance) : BigInt(right.balance);
    if (leftMagnitude !== rightMagnitude) return leftMagnitude > rightMagnitude ? -1 : 1;
    return compareText(left.displayName, right.displayName) || compareUserIds(left.userId, right.userId);
  }));
}

function memberContributions(source: AnalyticsSourceSnapshot, selectedMonth: CalendarMonth, spent: Poisha): readonly DashboardMemberContributionView[] {
  const contributions = calculateMemberContributions(source.expenses, selectedMonth)
    .filter((entry) => entry.paid > 0)
    .map((entry): DashboardMemberContributionView => Object.freeze({
      ...memberView(source, entry.userId),
      paid: entry.paid,
    }))
    .sort((left, right) => {
      if (left.paid !== right.paid) return left.paid > right.paid ? -1 : 1;
      return compareText(left.displayName, right.displayName) || compareUserIds(left.userId, right.userId);
    });
  const paidTotal = contributions.reduce((sum, entry) => sum + BigInt(entry.paid), BigInt(0));
  if (paidTotal !== BigInt(spent)) {
    throw new ApplicationError(
      "MALFORMED_PERSISTED_DATA",
      "Dashboard member payments do not reconcile with Household spending.",
    );
  }
  return Object.freeze(contributions);
}

export function buildDashboardPageView(
  source: AnalyticsSourceSnapshot,
  selectedMonth: CalendarMonth,
  currentMonth: CalendarMonth,
): DashboardPageView {
  const spent = calculateMonthlySpending(source.expenses, selectedMonth);
  return Object.freeze({
    selectedMonth,
    monthOptions: monthOptions(source, selectedMonth, currentMonth),
    members: activeMembers(source),
    spent,
    outstanding: viewerOutstanding(source),
    settlementHealth: settlementHealth(source),
    memberContributions: memberContributions(source, selectedMonth, spent),
    dailySpending: calculateDailySpending(source.expenses, selectedMonth),
    paymentMix: calculatePaymentMix(source.expenses, selectedMonth),
    housemateBalances: housemateBalances(source),
    recentExpenses: Object.freeze(selectRecentExpenses(source.expenses, selectedMonth).map((expense) => expenseView(source, expense))),
  });
}

export function buildMonthlyReportPageView(
  source: AnalyticsSourceSnapshot,
  selectedMonth: CalendarMonth,
  localMonthOfInstant: (instant: IsoInstant) => CalendarMonth,
  currentMonth: CalendarMonth,
): MonthlyReportPageView {
  const totalSpending = calculateMonthlySpending(source.expenses, selectedMonth);
  const contributions = calculateMemberContributions(source.expenses, selectedMonth).map((entry): MonthlyReportMemberView => Object.freeze({
    ...memberView(source, entry.userId),
    paid: entry.paid,
    share: entry.share,
  })).sort((left, right) => {
    if (left.paid !== right.paid) return left.paid > right.paid ? -1 : 1;
    if (left.share !== right.share) return left.share > right.share ? -1 : 1;
    return compareText(left.displayName, right.displayName) || compareUserIds(left.userId, right.userId);
  });
  const paidTotal = contributions.reduce((sum, member) => sum + BigInt(member.paid), BigInt(0));
  const shareTotal = contributions.reduce((sum, member) => sum + BigInt(member.share), BigInt(0));
  if (paidTotal !== BigInt(totalSpending) || shareTotal !== BigInt(totalSpending)) {
    throw new ApplicationError(
      "MALFORMED_PERSISTED_DATA",
      "Monthly member totals do not reconcile with Household spending.",
    );
  }
  const currentOutstandingTotal = poishaFromBigInt(source.recommendations.reduce(
    (sum, recommendation) => sum + BigInt(recommendation.amount),
    BigInt(0),
  ));
  return Object.freeze({
    selectedMonth,
    monthOptions: monthOptions(source, selectedMonth, currentMonth, localMonthOfInstant),
    totalSpending,
    expenseCount: selectedMonthExpenses(source.expenses, selectedMonth).length,
    comparison: calculateMonthComparison(totalSpending, calculateMonthlySpending(source.expenses, previousCalendarMonth(selectedMonth))),
    dailySpending: calculateDailySpending(source.expenses, selectedMonth),
    paymentMix: calculatePaymentMix(source.expenses, selectedMonth),
    members: Object.freeze(contributions),
    largestExpenses: Object.freeze(selectLargestExpenses(source.expenses, selectedMonth).map((expense) => expenseView(source, expense))),
    settlementActivity: calculateSettlementActivity(source.settlements, selectedMonth, localMonthOfInstant),
    currentOutstanding: Object.freeze({ count: source.recommendations.length, total: currentOutstandingTotal }),
  });
}
