"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ApplicationError } from "@/application/errors/application-error";
import type { ProductCapabilities } from "@/application/runtime-capabilities";
import type { CalendarMonth } from "@/application/analytics/calendar-month";
import { parseWithBigInt } from "@/application/transport/json-bigint";
import { Toaster } from "@/components/ui/sonner";
import type {
  CardPageView,
  CardRemovalPreview,
  MyCardSummaryView,
} from "@/application/cards/card-page";
import type {
  DashboardPageView,
  MonthlyReportPageView,
} from "@/application/analytics/analytics-page";
import type {
  PendingSettlementView,
  SettlementPageView,
} from "@/application/settlements/settlement-page";
import type { HouseholdAccessState } from "@/application/services/application-services";
import type {
  ExpenseActivityView,
  ExpenseMemberView,
  ExpenseView,
  JoinableHouseholdView,
  ReceiptView,
} from "@/application/services/application-services";
import type { ExpenseDate } from "@/domain/dates/expense-date";
import type { CardId, CommandId, ExpenseId, HouseholdId, JoinRequestId, SettlementId, UserId } from "@/domain/shared/identifiers";
import { Surface } from "@/presentation/components/surface";
import {
  ApplicationRuntimeProvider,
  type AnalyticsApplicationActions,
  type ApplicationRuntimeState,
  type CardApplicationActions,
  type ExpenseApplicationActions,
  type HouseholdApplicationActions,
  type SettlementApplicationActions,
} from "@/presentation/runtime/application-runtime-context";
import { DevelopmentToolsProvider } from "@/presentation/devtools/development-tools";
import { AppShell } from "@/presentation/shell/app-shell";

/**
 * Production composition root over the Appwrite read plane (R1). Session and
 * product data arrive exclusively through trusted same-origin read endpoints;
 * this module never touches Appwrite, IndexedDB, or development identities.
 */

interface ProductionBootstrapPayload {
  readonly session: ApplicationRuntimeState extends never ? never : Extract<ApplicationRuntimeState, { status: "ready" }>["session"];
  readonly household: HouseholdAccessState;
  readonly capabilities: ProductCapabilities;
  readonly businessDate: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw Object.assign(new ApplicationError("PERSISTENCE_FAILURE", "The service is temporarily unavailable."), { status: 0 });
  }
  const text = await response.text();
  const payload = text.length > 0 ? parseWithBigInt<{ data?: T; error?: string }>(text) : {};
  if (!response.ok) {
    const code =
      response.status === 404 ? "NOT_FOUND"
      : response.status === 409 ? "CONFLICT"
      : response.status === 429 ? "RATE_LIMITED"
      : response.status === 401 || response.status === 403 ? "SESSION_UNAVAILABLE"
      : "PERSISTENCE_FAILURE";
    throw Object.assign(
      new ApplicationError(code, payload.error ?? "The service is temporarily unavailable."),
      { status: response.status },
    );
  }
  return (payload.data ?? payload) as T;
}

function isStatusFailure(error: unknown): error is Error & { status: number } {
  return error instanceof Error && typeof (error as { status?: unknown }).status === "number";
}

/** Defense in depth only: capabilities disable these actions before invocation. */
function commandUnavailable(): Promise<never> {
  return Promise.reject(
    new ApplicationError("COMMANDS_UNAVAILABLE", "This action arrives with the next production update."),
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background" role="status" aria-label="Loading">
      <div className="grid gap-3 text-center text-body text-text-muted">Loading…</div>
    </main>
  );
}

function AnonymousRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return <LoadingScreen />;
}

function UnavailableScreen({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10" role="status">
      <Surface padding="canonical" className="max-w-md text-center">
        <h1 className="text-h2 font-semibold">Service temporarily unavailable</h1>
        <p className="mt-2 text-body text-text-secondary">We could not reach your data right now. Please retry shortly.</p>
        <Button className="mx-auto mt-6" onClick={onRetry}>Retry</Button>
      </Surface>
    </main>
  );
}

function buildReadyState(
  bootstrap: ProductionBootstrapPayload,
  signOut: () => Promise<void>,
  refresh: () => Promise<void>,
): ApplicationRuntimeState {
  const { session, household, capabilities, businessDate } = bootstrap;

  const retryCommandIds = new Map<string, string>();
  const postCommand = async (path: string, body: Record<string, unknown>): Promise<void> => {
    await requestJson(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
  };
  const postGeneratedCommand = async (path: string, intent: Record<string, unknown>): Promise<void> => {
    const retryKey = `${path}:${JSON.stringify(intent)}`;
    const commandId = retryCommandIds.get(retryKey) ?? crypto.randomUUID();
    retryCommandIds.set(retryKey, commandId);
    await postCommand(path, { ...intent, commandId });
    retryCommandIds.delete(retryKey);
  };

  const householdActions: HouseholdApplicationActions = Object.freeze({
    generateCode: () => requestJson<string>("/api/app/household-code-candidate"),
    findHousehold: async (code: string) =>
      requestJson<JoinableHouseholdView>("/api/app/household-lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
    createHousehold: (name: string, code: string, commandId: CommandId) => postCommand("/api/app/household-create", { name, code, commandId }),
    requestToJoin: (householdId: HouseholdId, commandId: CommandId) => postCommand("/api/app/household-request-join", { householdId, commandId }),
    cancelJoinRequest: (joinRequestId: JoinRequestId) => postGeneratedCommand("/api/app/household-cancel-request", { joinRequestId }),
    acceptJoinRequest: (joinRequestId: JoinRequestId) => postGeneratedCommand("/api/app/household-accept-request", { joinRequestId }),
    rejectJoinRequest: (joinRequestId: JoinRequestId) => postGeneratedCommand("/api/app/household-reject-request", { joinRequestId }),
    leaveHousehold: () => postGeneratedCommand("/api/app/household-leave", {}),
    renameHousehold: (name: string) => postGeneratedCommand("/api/app/household-rename", { name }),
    removeMember: (memberId: UserId) => postGeneratedCommand("/api/app/household-remove-member", { memberId }),
    transferLeadership: (memberId: UserId) => postGeneratedCommand("/api/app/household-transfer-leadership", { memberId }),
    deleteHousehold: () => postGeneratedCommand("/api/app/household-delete", {}),
    refresh,
  });

  const expenseActions: ExpenseApplicationActions = Object.freeze({
    getCurrentBusinessDate: async () => businessDate as ExpenseDate,
    getMyAvailableReceiptBytes: () => requestJson<number>("/api/app/receipt-quota"),
    listExpenses: (householdIdValue: HouseholdId, includeDeleted?: boolean) =>
      requestJson<readonly ExpenseView[]>(`/api/app/expenses?householdId=${encodeURIComponent(householdIdValue)}&includeDeleted=${includeDeleted ? "true" : "false"}`),
    listMembers: (householdIdValue: HouseholdId) =>
      requestJson<readonly ExpenseMemberView[]>(`/api/app/household-members?householdId=${encodeURIComponent(householdIdValue)}`),
    listSelectableCards: async () => {
      const page = await requestJson<CardPageView>("/api/app/cards");
      return page.cards as readonly MyCardSummaryView[];
    },
    getExpense: (expenseIdValue: ExpenseId) =>
      requestJson<ExpenseView>(`/api/app/expense?id=${encodeURIComponent(expenseIdValue)}`),
    createExpense: () => commandUnavailable(),
    editExpense: () => commandUnavailable(),
    deleteExpense: () => commandUnavailable(),
    listReceipts: (expenseIdValue: ExpenseId) =>
      requestJson<readonly ReceiptView[]>(`/api/app/expense-receipts?id=${encodeURIComponent(expenseIdValue)}`),
    readReceipt: () => commandUnavailable(),
    deleteReceipt: () => commandUnavailable(),
    listActivity: (expenseIdValue: ExpenseId) =>
      requestJson<readonly ExpenseActivityView[]>(`/api/app/expense-activity?id=${encodeURIComponent(expenseIdValue)}`),
  });

  const settlementActions: SettlementApplicationActions = Object.freeze({
    getPage: (householdIdValue: HouseholdId) =>
      requestJson<SettlementPageView>(`/api/app/settlements?householdId=${encodeURIComponent(householdIdValue)}`),
    getPendingPreview: (settlementIdValue: SettlementId) =>
      requestJson<PendingSettlementView>(`/api/app/settlement-preview?id=${encodeURIComponent(settlementIdValue)}`),
    markRecommendationPaid: () => commandUnavailable(),
    confirm: () => commandUnavailable(),
    reject: () => commandUnavailable(),
    cancel: () => commandUnavailable(),
  });

  const cardActions: CardApplicationActions = Object.freeze({
    getMyCards: () => requestJson<CardPageView>("/api/app/cards"),
    createMyCard: () => commandUnavailable(),
    updateMyCard: () => commandUnavailable(),
    getRemovalPreview: (cardIdValue: CardId) =>
      requestJson<CardRemovalPreview>(`/api/app/card-removal-preview?id=${encodeURIComponent(cardIdValue)}`),
    deleteOrArchive: () => commandUnavailable(),
  });

  const analyticsActions: AnalyticsApplicationActions = Object.freeze({
    getDashboard: (householdIdValue: HouseholdId, month: CalendarMonth) =>
      requestJson<DashboardPageView>(`/api/app/dashboard?householdId=${encodeURIComponent(householdIdValue)}&month=${month}`),
    getMonthlyReport: (householdIdValue: HouseholdId, month: CalendarMonth) =>
      requestJson<MonthlyReportPageView>(`/api/app/monthly-report?householdId=${encodeURIComponent(householdIdValue)}&month=${month}`),
  });

  return Object.freeze({
    status: "ready" as const,
    session,
    household,
    capabilities,
    signOut,
    householdActions,
    expenseActions,
    settlementActions,
    cardActions,
    analyticsActions,
  });
}

export function ProductionApplicationRuntime({ children }: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<ApplicationRuntimeState>({ status: "loading" });
  const [anonymous, setAnonymous] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => undefined);

  const refresh = useCallback(async () => {
    try {
      const bootstrap = await requestJson<ProductionBootstrapPayload>("/api/app/bootstrap");
      const signOut = async () => {
        try {
          await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        } catch {
          // Even without remote confirmation, the local cookie is cleared by the endpoint.
        }
        setAnonymous(true);
      };
      setState(buildReadyState(bootstrap, signOut, () => refreshRef.current()));
    } catch (error) {
      if (isStatusFailure(error) && (error.status === 401 || error.status === 403)) {
        setAnonymous(true);
        return;
      }
      setState({ status: "error", message: "Your data could not be loaded right now.", retry: () => void refreshRef.current() });
    }
  }, []);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  if (anonymous) return <AnonymousRedirect />;

  if (state.status === "error") {
    return <UnavailableScreen onRetry={() => void refresh()} />;
  }

  if (state.status !== "ready") return <LoadingScreen />;

  return (
    <ApplicationRuntimeProvider value={state}>
      <DevelopmentToolsProvider value={undefined}>
        <AppShell>{children}</AppShell>
      </DevelopmentToolsProvider>
      <Toaster closeButton position="top-right" richColors />
    </ApplicationRuntimeProvider>
  );
}
