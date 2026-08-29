"use client";

import { createContext, useContext } from "react";
import type {
  CardPageView,
  CardRemovalPreview,
  MyCardSummaryView,
} from "@/application/cards/card-page";
import type {
  CreateExpenseCommand,
  EditExpenseCommand,
  ExpenseActivityView,
  ExpenseReceiptContent,
  HouseholdAccessState,
  ExpenseMemberView,
  ReceiptView,
  ExpenseView,
  JoinableHouseholdView,
} from "@/application/services/application-services";
import type { CardFormValues } from "@/application/validation/card-form.schema";
import type { CardRemovalAction, CardRemovalResult } from "@/domain/cards/card-lifecycle";
import type {
  PendingSettlementView,
  SettlementPageView,
} from "@/application/settlements/settlement-page";
import type {
  DashboardPageView,
  MonthlyReportPageView,
} from "@/application/analytics/analytics-page";
import type { CalendarMonth } from "@/application/analytics/calendar-month";
import type { SettlementRecommendation } from "@/domain/settlements/settlement-types";
import type { ExpenseDate } from "@/domain/dates/expense-date";
import type {
  ExpenseId,
  CardId,
  CommandId,
  HouseholdId,
  JoinRequestId,
  ReceiptId,
  SettlementId,
  UserId,
} from "@/domain/shared/identifiers";

export type { CurrentSessionView } from "@/application/session/current-session-view";
import type { CurrentSessionView } from "@/application/session/current-session-view";
import type { ProductCapabilities } from "@/application/runtime-capabilities";

export interface HouseholdApplicationActions {
  readonly generateCode: () => Promise<string>;
  readonly createHousehold: (name: string, code: string, commandId: CommandId) => Promise<void>;
  readonly findHousehold: (code: string) => Promise<JoinableHouseholdView>;
  readonly requestToJoin: (householdId: HouseholdId, commandId: CommandId) => Promise<void>;
  readonly cancelJoinRequest: (joinRequestId: JoinRequestId) => Promise<void>;
  readonly acceptJoinRequest: (joinRequestId: JoinRequestId) => Promise<void>;
  readonly rejectJoinRequest: (joinRequestId: JoinRequestId) => Promise<void>;
  readonly leaveHousehold: () => Promise<void>;
  readonly renameHousehold: (name: string) => Promise<void>;
  readonly removeMember: (memberId: UserId) => Promise<void>;
  readonly transferLeadership: (memberId: UserId) => Promise<void>;
  readonly deleteHousehold: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

export interface ExpenseApplicationActions {
  readonly getCurrentBusinessDate: () => Promise<ExpenseDate>;
  readonly getMyAvailableReceiptBytes: () => Promise<number>;
  readonly listExpenses: (
    householdId: HouseholdId,
    includeDeleted?: boolean,
  ) => Promise<readonly ExpenseView[]>;
  readonly listMembers: (
    householdId: HouseholdId,
  ) => Promise<readonly ExpenseMemberView[]>;
  readonly listSelectableCards: () => Promise<readonly MyCardSummaryView[]>;
  readonly getExpense: (expenseId: ExpenseId) => Promise<ExpenseView>;
  readonly createExpense: (command: CreateExpenseCommand) => Promise<ExpenseView>;
  readonly editExpense: (command: EditExpenseCommand) => Promise<ExpenseView>;
  readonly deleteExpense: (expenseId: ExpenseId, expectedRevision: number) => Promise<void>;
  readonly listReceipts: (
    expenseId: ExpenseId,
  ) => Promise<readonly ReceiptView[]>;
  readonly readReceipt: (receiptId: ReceiptId) => Promise<ExpenseReceiptContent>;
  readonly deleteReceipt: (receiptId: ReceiptId) => Promise<void>;
  readonly listActivity: (
    expenseId: ExpenseId,
  ) => Promise<readonly ExpenseActivityView[]>;
}

export interface CardApplicationActions {
  readonly getMyCards: () => Promise<CardPageView>;
  readonly createMyCard: (input: CardFormValues & Readonly<{ commandId: CommandId }>) => Promise<MyCardSummaryView>;
  readonly updateMyCard: (cardId: CardId, input: CardFormValues) => Promise<MyCardSummaryView>;
  readonly getRemovalPreview: (cardId: CardId) => Promise<CardRemovalPreview>;
  readonly deleteOrArchive: (
    cardId: CardId,
    expectedAction: CardRemovalAction,
  ) => Promise<CardRemovalResult>;
}

export interface SettlementApplicationActions {
  readonly getPage: (householdId: HouseholdId) => Promise<SettlementPageView>;
  readonly getPendingPreview: (
    settlementId: SettlementId,
  ) => Promise<PendingSettlementView>;
  readonly markRecommendationPaid: (
    recommendation: SettlementRecommendation,
    commandId: CommandId,
  ) => Promise<void>;
  readonly confirm: (settlementId: SettlementId) => Promise<void>;
  readonly reject: (settlementId: SettlementId) => Promise<void>;
  readonly cancel: (settlementId: SettlementId) => Promise<void>;
}

export interface AnalyticsApplicationActions {
  readonly getDashboard: (
    householdId: HouseholdId,
    month: CalendarMonth,
  ) => Promise<DashboardPageView>;
  readonly getMonthlyReport: (
    householdId: HouseholdId,
    month: CalendarMonth,
  ) => Promise<MonthlyReportPageView>;
}

export type ApplicationRuntimeState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      session: CurrentSessionView;
      household: HouseholdAccessState;
      /** Honest per-composition capability report (R1-9). */
      capabilities: ProductCapabilities;
      /** Present only where real sign-out exists (production); local keeps its explained placeholder. */
      signOut?: () => Promise<void>;
      householdActions: HouseholdApplicationActions;
      expenseActions: ExpenseApplicationActions;
      settlementActions: SettlementApplicationActions;
      cardActions: CardApplicationActions;
      analyticsActions: AnalyticsApplicationActions;
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
