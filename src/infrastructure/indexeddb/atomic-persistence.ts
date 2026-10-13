import { DEFAULT_RECEIPT_STORAGE_POLICY, type ReceiptStoragePolicy } from "@/application/receipts/receipt-storage-policy";
import type { AtomicApplicationPersistence } from "@/application/repositories";


import type { DatabaseSource } from "./database";
import { IndexedDbCommandContext } from "./atomic-context";
import { IndexedDbHouseholdCommands } from "./atomic-household";
import { IndexedDbProfileCommands } from "./atomic-profile";
import { IndexedDbExpenseCommands } from "./atomic-expense";
import { IndexedDbSettlementCommands } from "./atomic-settlement";
import { IndexedDbCardCommands } from "./atomic-card";
import { IndexedDbReceiptCommands } from "./atomic-receipt";
import { IndexedDbNotificationCommands } from "./atomic-notification";

/** Public persistence API. Feature commands share one internal context per adapter. */
export class IndexedDbAtomicApplicationPersistence implements AtomicApplicationPersistence {
  private readonly context: IndexedDbCommandContext;
  private readonly household: IndexedDbHouseholdCommands;
  private readonly profile: IndexedDbProfileCommands;
  private readonly expense: IndexedDbExpenseCommands;
  private readonly settlement: IndexedDbSettlementCommands;
  private readonly card: IndexedDbCardCommands;
  private readonly receipt: IndexedDbReceiptCommands;
  private readonly notification: IndexedDbNotificationCommands;

  constructor(source: DatabaseSource, receiptStoragePolicy: ReceiptStoragePolicy = DEFAULT_RECEIPT_STORAGE_POLICY) {
    this.context = new IndexedDbCommandContext(source, receiptStoragePolicy);
    this.household = new IndexedDbHouseholdCommands(this.context);
    this.profile = new IndexedDbProfileCommands(this.context);
    this.expense = new IndexedDbExpenseCommands(this.context);
    this.settlement = new IndexedDbSettlementCommands(this.context);
    this.card = new IndexedDbCardCommands(this.context);
    this.receipt = new IndexedDbReceiptCommands(this.context);
    this.notification = new IndexedDbNotificationCommands(this.context);
  }

  async createHousehold(input: Parameters<AtomicApplicationPersistence["createHousehold"]>[0]): Promise<string> { return this.household.createHousehold(input); }

  async renameHousehold(input: Parameters<AtomicApplicationPersistence["renameHousehold"]>[0]): Promise<void> { return this.household.renameHousehold(input); }

  async createJoinRequest(input: Parameters<AtomicApplicationPersistence["createJoinRequest"]>[0]): Promise<string> { return this.household.createJoinRequest(input); }

  async acceptJoinRequest(input: Parameters<AtomicApplicationPersistence["acceptJoinRequest"]>[0]): Promise<void> { return this.household.acceptJoinRequest(input); }

  async transitionJoinRequest(input: Parameters<AtomicApplicationPersistence["transitionJoinRequest"]>[0]): Promise<void> { return this.household.transitionJoinRequest(input); }

  async transferLeadership(input: Parameters<AtomicApplicationPersistence["transferLeadership"]>[0]): Promise<void> { return this.household.transferLeadership(input); }

  async leaveHousehold(input: Parameters<AtomicApplicationPersistence["leaveHousehold"]>[0]): Promise<void> { return this.household.leaveHousehold(input); }

  async removeHouseholdMember(input: Parameters<AtomicApplicationPersistence["removeHouseholdMember"]>[0]): Promise<void> { return this.household.removeHouseholdMember(input); }

  async deleteHousehold(input: Parameters<AtomicApplicationPersistence["deleteHousehold"]>[0]): Promise<void> { return this.household.deleteHousehold(input); }

  async updateCurrentProfile(input: Parameters<AtomicApplicationPersistence["updateCurrentProfile"]>[0]): Promise<void> { return this.profile.updateCurrentProfile(input); }

  async createExpense(input: Parameters<AtomicApplicationPersistence["createExpense"]>[0]): Promise<string> { return this.expense.createExpense(input); }

  async createExpenseComment(input: Parameters<AtomicApplicationPersistence["createExpenseComment"]>[0]): Promise<string> { return this.expense.createExpenseComment(input); }

  async editExpense(input: Parameters<AtomicApplicationPersistence["editExpense"]>[0]): Promise<void> { return this.expense.editExpense(input); }

  async createSettlement(input: Parameters<AtomicApplicationPersistence["createSettlement"]>[0]): Promise<string> { return this.settlement.createSettlement(input); }

  async transitionSettlement(input: Parameters<AtomicApplicationPersistence["transitionSettlement"]>[0]): Promise<void> { return this.settlement.transitionSettlement(input); }

  async createCard(input: Parameters<AtomicApplicationPersistence["createCard"]>[0]): Promise<string> { return this.card.createCard(input); }

  async updateCard(input: Parameters<AtomicApplicationPersistence["updateCard"]>[0]): Promise<void> { return this.card.updateCard(input); }

  async removeCard(input: Parameters<AtomicApplicationPersistence["removeCard"]>[0]) { return this.card.removeCard(input); }

  async createReceipt(input: Parameters<AtomicApplicationPersistence["createReceipt"]>[0]): Promise<string> { return this.receipt.createReceipt(input); }

  async deleteReceipt(input: Parameters<AtomicApplicationPersistence["deleteReceipt"]>[0]): Promise<void> { return this.receipt.deleteReceipt(input); }

  async markNotificationRead(input: Parameters<AtomicApplicationPersistence["markNotificationRead"]>[0]): Promise<void> { return this.notification.markNotificationRead(input); }

  async markNotificationsRead(input: Parameters<AtomicApplicationPersistence["markNotificationsRead"]>[0]): Promise<number> { return this.notification.markNotificationsRead(input); }
}
