import { ApplicationError } from "@/application/errors/application-error";
import type { ApplicationRepositories, CurrentSession } from "@/application/repositories";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import { toBalanceExpense } from "@/domain/records/domain-records";
import type { HouseholdId, UserId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import { currentLocalCalendarMonth, type CalendarMonth } from "./calendar-month";
import {
  buildDashboardPageView,
  buildMonthlyReportPageView,
  type AnalyticsSourceSnapshot,
  type DashboardPageView,
  type MonthlyReportPageView,
} from "./analytics-page";

export class HouseholdAnalyticsApplicationService {
  constructor(
    private readonly repositories: ApplicationRepositories,
    private readonly session: CurrentSession,
  ) {}

  private async source(householdId: HouseholdId): Promise<AnalyticsSourceSnapshot> {
    const actorId = await this.session.getCurrentUserId();
    const [household, membership, memberships, expenses, settlements] = await Promise.all([
      this.repositories.households.getById(householdId),
      this.repositories.memberships.get(householdId, actorId),
      this.repositories.memberships.listByHousehold(householdId),
      this.repositories.expenses.listHouseholdHistory(householdId),
      this.repositories.settlements.listByHousehold(householdId),
    ]);
    if (!household || household.deletedAt || !membership || membership.status !== "active") {
      throw new ApplicationError("NOT_FOUND", "Active household membership not found.");
    }
    const identityIds = new Set<UserId>(memberships.map((item) => item.userId));
    for (const expense of expenses) {
      identityIds.add(expense.payerId);
      expense.allocations.forEach((allocation) => identityIds.add(allocation.participantId));
    }
    const profiles = await this.repositories.profiles.getByIds([...identityIds]);
    const sheet = calculateHouseholdBalances(
      householdId,
      memberships,
      expenses.map(toBalanceExpense),
      settlements,
    );
    return Object.freeze({
      householdId,
      actorId,
      memberships,
      profiles,
      expenses,
      settlements,
      sheet,
      recommendations: generateSettlementRecommendations(sheet),
    });
  }

  async getDashboard(householdId: HouseholdId, selectedMonth: CalendarMonth): Promise<DashboardPageView> {
    return buildDashboardPageView(await this.source(householdId), selectedMonth, currentLocalCalendarMonth());
  }

  async getMonthlyReport(
    householdId: HouseholdId,
    selectedMonth: CalendarMonth,
    localMonthOfInstant: (instant: IsoInstant) => CalendarMonth,
  ): Promise<MonthlyReportPageView> {
    return buildMonthlyReportPageView(await this.source(householdId), selectedMonth, localMonthOfInstant, currentLocalCalendarMonth());
  }
}
