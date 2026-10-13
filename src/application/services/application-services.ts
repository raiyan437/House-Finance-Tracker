import { HouseholdAnalyticsApplicationService } from "../analytics/analytics-service";
import { NotificationApplicationService } from "@/application/notifications/notification-service";
import { type Dependencies } from "./service-context";
import { ProfileApplicationService } from "./profile-service";
import { HouseholdApplicationService } from "./household-service";
import { ExpenseApplicationService } from "./expense-service";
import { SettlementApplicationService } from "./settlement-service";
import { CardApplicationService } from "./card-service";
import { ReceiptApplicationService } from "./receipt-service";

export { type GeneratedIdKind, type ApplicationValues, type Dependencies } from "./service-context";
export { ProfileApplicationService } from "./profile-service";
export { type JoinableHouseholdView, type PendingJoinRequestView, type LeaderJoinRequestView, type HouseholdAccessState, HouseholdApplicationService } from "./household-service";
export { type CreateExpenseCommand, type ExpenseView, type ExpenseCommentView, type ExpenseFinancialEditReason, type ExpenseFinancialEditability, type ExpenseMemberView, type ExpenseActivityView, type EditExpenseCommand, ExpenseApplicationService } from "./expense-service";
export { SettlementApplicationService } from "./settlement-service";
export { CardApplicationService } from "./card-service";
export { type ExpenseReceiptContent, type ReceiptView, ReceiptApplicationService } from "./receipt-service";

export class HouseFinanceApplication {
  readonly analytics: HouseholdAnalyticsApplicationService;
  readonly profiles: ProfileApplicationService;
  readonly households: HouseholdApplicationService;
  readonly expenses: ExpenseApplicationService;
  readonly settlements: SettlementApplicationService;
  readonly cards: CardApplicationService;
  readonly receipts: ReceiptApplicationService;
  readonly notifications: NotificationApplicationService;
  constructor(deps: Dependencies) { this.analytics = new HouseholdAnalyticsApplicationService(deps.repositories, deps.session); this.profiles = new ProfileApplicationService(deps); this.households = new HouseholdApplicationService(deps); this.expenses = new ExpenseApplicationService(deps); this.settlements = new SettlementApplicationService(deps); this.cards = new CardApplicationService(deps); this.receipts = new ReceiptApplicationService(deps); this.notifications = new NotificationApplicationService({ repositories: deps.repositories, atomic: deps.atomic, session: deps.session, now: deps.values.now }); }
}
