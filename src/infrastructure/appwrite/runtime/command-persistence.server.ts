import "server-only";
import type { TablesDB } from "node-appwrite";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import type { CardRemovalResult } from "@/domain/cards/card-lifecycle";
import type { BackdatedExpenseConfirmationAuthority } from "@/application/expenses/backdated-expense-confirmation";
import { AppwriteCommandContext } from "./command-context.server";
import { AppwriteHouseholdCommands } from "./command-household.server";
import { AppwriteProfileCommands } from "./command-profile.server";
import { AppwriteExpenseCommands } from "./command-expense.server";
import { AppwriteSettlementCommands } from "./command-settlement.server";
import { AppwriteCardCommands } from "./command-card.server";
import { AppwriteReceiptCommands } from "./command-receipt.server";
import { AppwriteNotificationCommands } from "./command-notification.server";

/** Public persistence API. Feature commands share one internal context per adapter. */
export class AppwriteCommandPersistence implements AtomicApplicationPersistence {
  private readonly context: AppwriteCommandContext;
  private readonly household: AppwriteHouseholdCommands;
  private readonly profile: AppwriteProfileCommands;
  private readonly expense: AppwriteExpenseCommands;
  private readonly settlement: AppwriteSettlementCommands;
  private readonly card: AppwriteCardCommands;
  private readonly receipt: AppwriteReceiptCommands;
  private readonly notification: AppwriteNotificationCommands;

  constructor(tablesDB: TablesDB, backdatedConfirmationAuthority?: BackdatedExpenseConfirmationAuthority) {
    this.context = new AppwriteCommandContext(tablesDB, backdatedConfirmationAuthority);
    this.household = new AppwriteHouseholdCommands(this.context);
    this.profile = new AppwriteProfileCommands(this.context);
    this.expense = new AppwriteExpenseCommands(this.context);
    this.settlement = new AppwriteSettlementCommands(this.context);
    this.card = new AppwriteCardCommands(this.context);
    this.receipt = new AppwriteReceiptCommands(this.context);
    this.notification = new AppwriteNotificationCommands(this.context);
  }

  get lastDeleteStagedOperations(): number { return this.context.lastDeleteStagedOperations; }

  set lastDeleteStagedOperations(value: number) { this.context.lastDeleteStagedOperations = value; }

  get lastR3StagedOperations(): Partial<Record<string, number>> { return this.context.lastR3StagedOperations; }

  async createHousehold(input: Parameters<AtomicApplicationPersistence["createHousehold"]>[0]): Promise<string> { return this.household.createHousehold(input); }

  async createJoinRequest(input: Parameters<AtomicApplicationPersistence["createJoinRequest"]>[0]): Promise<string> { return this.household.createJoinRequest(input); }

  async acceptJoinRequest(input: Parameters<AtomicApplicationPersistence["acceptJoinRequest"]>[0]): Promise<void> { return this.household.acceptJoinRequest(input); }

  async transitionJoinRequest(input: Parameters<AtomicApplicationPersistence["transitionJoinRequest"]>[0]): Promise<void> { return this.household.transitionJoinRequest(input); }

  async renameHousehold(input: Parameters<AtomicApplicationPersistence["renameHousehold"]>[0]): Promise<void> { return this.household.renameHousehold(input); }

  async transferLeadership(input: Parameters<AtomicApplicationPersistence["transferLeadership"]>[0]): Promise<void> { return this.household.transferLeadership(input); }

  async leaveHousehold(input: Parameters<AtomicApplicationPersistence["leaveHousehold"]>[0]): Promise<void> { return this.household.leaveHousehold(input); }

  async removeHouseholdMember(input: Parameters<AtomicApplicationPersistence["removeHouseholdMember"]>[0]): Promise<void> { return this.household.removeHouseholdMember(input); }

  async deleteHousehold(input: Parameters<AtomicApplicationPersistence["deleteHousehold"]>[0]): Promise<void> { return this.household.deleteHousehold(input); }

  async updateCurrentProfile(input: Parameters<AtomicApplicationPersistence["updateCurrentProfile"]>[0]): Promise<void> { return this.profile.updateCurrentProfile(input); }

  async createExpense(input: Parameters<AtomicApplicationPersistence["createExpense"]>[0]): Promise<string> { return this.expense.createExpense(input); }

  async editExpense(input: Parameters<AtomicApplicationPersistence["editExpense"]>[0]): Promise<void> { return this.expense.editExpense(input); }

  async createExpenseComment(input: Parameters<AtomicApplicationPersistence["createExpenseComment"]>[0]): Promise<string> { return this.expense.createExpenseComment(input); }

  async createSettlement(input: Parameters<AtomicApplicationPersistence["createSettlement"]>[0]): Promise<string> { return this.settlement.createSettlement(input); }

  async transitionSettlement(input: Parameters<AtomicApplicationPersistence["transitionSettlement"]>[0]): Promise<void> { return this.settlement.transitionSettlement(input); }

  async createCard(input: Parameters<AtomicApplicationPersistence["createCard"]>[0]): Promise<string> { return this.card.createCard(input); }

  async updateCard(input: Parameters<AtomicApplicationPersistence["updateCard"]>[0]): Promise<void> { return this.card.updateCard(input); }

  async removeCard(input: Parameters<AtomicApplicationPersistence["removeCard"]>[0]): Promise<CardRemovalResult> { return this.card.removeCard(input); }

  createReceipt(): Promise<string> { return this.receipt.createReceipt(); }

  deleteReceipt(): Promise<void> { return this.receipt.deleteReceipt(); }

  async markNotificationRead(input: Parameters<AtomicApplicationPersistence["markNotificationRead"]>[0]): Promise<void> { return this.notification.markNotificationRead(input); }

  async markNotificationsRead(input: Parameters<AtomicApplicationPersistence["markNotificationsRead"]>[0]): Promise<number> { return this.notification.markNotificationsRead(input); }
}
