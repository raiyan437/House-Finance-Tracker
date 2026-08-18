"use client";

import { createContext, useContext } from "react";
import type {
  CreateExpenseCommand,
  EditExpenseCommand,
  ExpenseActivityView,
  ExpenseReceiptContent,
  HouseholdAccessState,
  ExpenseMemberView,
  ExpenseView,
  JoinableHouseholdView,
} from "@/application/services/application-services";
import type {
  PendingSettlementView,
  SettlementPageView,
} from "@/application/settlements/settlement-page";
import type { Card, ReceiptMetadata } from "@/domain/records/domain-records";
import type { SettlementRecommendation } from "@/domain/settlements/settlement-types";
import type {
  ExpenseId,
  HouseholdId,
  JoinRequestId,
  ReceiptId,
  SettlementId,
  UserId,
} from "@/domain/shared/identifiers";

export interface CurrentSessionView {
  readonly userId: UserId;
  readonly displayName: string;
  readonly displayEmail: string;
  readonly roleLabel: "Leader" | "Member" | "No active household";
  readonly householdName?: string;
  readonly settlementActionCount: number;
}

export interface HouseholdApplicationActions {
  readonly generateCode: () => Promise<string>;
  readonly createHousehold: (name: string, code: string) => Promise<void>;
  readonly findHousehold: (code: string) => Promise<JoinableHouseholdView>;
  readonly requestToJoin: (householdId: HouseholdId) => Promise<void>;
  readonly cancelJoinRequest: (joinRequestId: JoinRequestId) => Promise<void>;
  readonly acceptJoinRequest: (joinRequestId: JoinRequestId) => Promise<void>;
  readonly rejectJoinRequest: (joinRequestId: JoinRequestId) => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export interface ExpenseApplicationActions {
  readonly listExpenses: (
    householdId: HouseholdId,
    includeDeleted?: boolean,
  ) => Promise<readonly ExpenseView[]>;
  readonly listMembers: (
    householdId: HouseholdId,
  ) => Promise<readonly ExpenseMemberView[]>;
  readonly listSelectableCards: () => Promise<readonly Card[]>;
  readonly getExpense: (expenseId: ExpenseId) => Promise<ExpenseView>;
  readonly createExpense: (command: CreateExpenseCommand) => Promise<ExpenseView>;
  readonly editExpense: (command: EditExpenseCommand) => Promise<ExpenseView>;
  readonly deleteExpense: (expenseId: ExpenseId) => Promise<void>;
  readonly listReceipts: (
    expenseId: ExpenseId,
  ) => Promise<readonly ReceiptMetadata[]>;
  readonly readReceipt: (receiptId: ReceiptId) => Promise<ExpenseReceiptContent>;
  readonly deleteReceipt: (receiptId: ReceiptId) => Promise<void>;
  readonly listActivity: (
    expenseId: ExpenseId,
  ) => Promise<readonly ExpenseActivityView[]>;
}

export interface SettlementApplicationActions {
  readonly getPage: (householdId: HouseholdId) => Promise<SettlementPageView>;
  readonly getPendingPreview: (
    settlementId: SettlementId,
  ) => Promise<PendingSettlementView>;
  readonly markRecommendationPaid: (
    recommendation: SettlementRecommendation,
  ) => Promise<void>;
  readonly confirm: (settlementId: SettlementId) => Promise<void>;
  readonly reject: (settlementId: SettlementId) => Promise<void>;
  readonly cancel: (settlementId: SettlementId) => Promise<void>;
}

export type ApplicationRuntimeState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      session: CurrentSessionView;
      household: HouseholdAccessState;
      householdActions: HouseholdApplicationActions;
      expenseActions: ExpenseApplicationActions;
      settlementActions: SettlementApplicationActions;
    }>
  | Readonly<{
      status: "error";
      message: string;
      retry: () => void;
    }>;

const ApplicationRuntimeContext = createContext<ApplicationRuntimeState | null>(
  null,
);

interface ApplicationRuntimeProviderProps {
  readonly value: ApplicationRuntimeState;
  readonly children: React.ReactNode;
}

export function ApplicationRuntimeProvider({
  value,
  children,
}: ApplicationRuntimeProviderProps) {
  return (
    <ApplicationRuntimeContext.Provider value={value}>
      {children}
    </ApplicationRuntimeContext.Provider>
  );
}

export function useApplicationRuntime(): ApplicationRuntimeState {
  const value = useContext(ApplicationRuntimeContext);

  if (!value) {
    throw new Error(
      "useApplicationRuntime must be used inside ApplicationRuntimeProvider.",
    );
  }

  return value;
}
