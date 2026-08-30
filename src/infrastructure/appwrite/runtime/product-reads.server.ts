import "server-only";
import type { HouseholdAccessState } from "@/application/services/application-services";
import type { ProductCapabilities } from "@/application/runtime-capabilities";
import { calendarMonth, localCalendarMonthFromInstant, type CalendarMonth } from "@/application/analytics/calendar-month";
import { businessDateAt } from "@/domain/dates/business-calendar";
import type { CardId, ExpenseId, HouseholdId, SettlementId } from "@/domain/shared/identifiers";
import type { CurrentSessionView } from "@/application/session/current-session-view";
import type { ProductRequestContext } from "./context.server";

export interface ProductionBootstrap {
  readonly session: CurrentSessionView;
  readonly household: HouseholdAccessState;
  readonly capabilities: ProductCapabilities;
  /** Server-authoritative Asia/Dhaka business date (frozen owner decision #2). */
  readonly businessDate: string;
}

async function sessionView(context: ProductRequestContext): Promise<CurrentSessionView> {
  const [profile, household, settlementActionCount] = await Promise.all([
    context.application.profiles.getCurrentProfile(),
    context.application.households.getCurrentAccessState(),
    context.application.settlements.countCurrentUserSettlementActions(),
  ]);
  const isLeader = household.status === "active-leader";
  const isMember = household.status === "active-member";
  return Object.freeze({
    userId: profile.userId,
    displayName: profile.displayName,
    // Appwrite Auth email is the single authoritative account email.
    displayEmail: context.actor.email,
    profileVersion: profile.version,
    roleLabel: isLeader ? "Leader" : isMember ? "Member" : "No active household",
    settlementActionCount,
    ...(isLeader || isMember ? { householdName: household.household.name } : {}),
  });
}

export async function loadBootstrap(context: ProductRequestContext): Promise<ProductionBootstrap> {
  const [session, household] = await Promise.all([
    sessionView(context),
    context.application.households.getCurrentAccessState(),
  ]);
  return Object.freeze({
    session,
    household,
    capabilities: context.capabilities,
    businessDate: businessDateAt(context.dependencies.values.now()),
  });
}

export async function loadHouseholdAccess(context: ProductRequestContext): Promise<HouseholdAccessState> {
  return context.application.households.getCurrentAccessState();
}

export async function loadBusinessDate(context: ProductRequestContext): Promise<string> {
  return businessDateAt(context.dependencies.values.now());
}

export function listMembers(context: ProductRequestContext, householdId: HouseholdId) {
  return context.application.expenses.listHouseholdMembers(householdId);
}

export function lookupHouseholdForJoin(context: ProductRequestContext, code: string) {
  return context.application.households.findHouseholdForJoin(code);
}

export function generateCodeCandidate(context: ProductRequestContext): Promise<string> {
  return context.application.households.generateUniqueHouseholdCode();
}

export function listExpenses(context: ProductRequestContext, householdId: HouseholdId, includeDeleted: boolean) {
  return context.application.expenses.listHouseholdExpenses(householdId, includeDeleted);
}

export function getExpense(context: ProductRequestContext, expenseId: ExpenseId) {
  return context.application.expenses.getExpense(expenseId);
}

export function listExpenseActivity(context: ProductRequestContext, expenseId: ExpenseId) {
  return context.application.expenses.listExpenseActivity(expenseId);
}

export function listExpenseReceipts(context: ProductRequestContext, expenseId: ExpenseId) {
  return context.application.receipts.listExpenseReceipts(expenseId);
}

export function receiptQuota(context: ProductRequestContext) {
  return context.application.receipts.getMyAvailableReceiptBytes();
}

export function getSettlementPage(context: ProductRequestContext, householdId: HouseholdId) {
  return context.application.settlements.getSettlementPage(householdId);
}

export function getPendingSettlementPreview(context: ProductRequestContext, settlementId: SettlementId) {
  return context.application.settlements.getPendingSettlementActionPreview(settlementId);
}

export function getMyCards(context: ProductRequestContext) {
  return context.application.cards.getMyCards();
}

export function getCardRemovalPreview(context: ProductRequestContext, cardId: CardId) {
  return context.application.cards.getMyCardRemovalPreview(cardId);
}

export function getDashboard(context: ProductRequestContext, householdId: HouseholdId, month: CalendarMonth) {
  return context.application.analytics.getDashboard(householdId, month);
}

export function getMonthlyReport(context: ProductRequestContext, householdId: HouseholdId, monthValue: string) {
  return context.application.analytics.getMonthlyReport(householdId, calendarMonth(monthValue), localCalendarMonthFromInstant);
}
