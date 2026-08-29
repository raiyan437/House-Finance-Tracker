"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ApplicationError, BackdatedExpenseConfirmationRequiredError, ReceiptSagaPartialSuccessError, type ApplicationErrorCode } from "@/application/errors/application-error";
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
  ExpenseReceiptContent,
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
import { DevelopmentToolsSlotsProvider } from "@/presentation/devtools/development-tools-slots";
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
  const payload = text.length > 0 ? parseWithBigInt<{ data?: T; error?: string; code?: ApplicationErrorCode; confirmationToken?: string }>(text) : {};
  if (!response.ok) {
    if (payload.code === "BACKDATED_EXPENSE_CONFIRMATION_REQUIRED" && payload.confirmationToken) {
      throw Object.assign(new BackdatedExpenseConfirmationRequiredError(payload.confirmationToken), { status: response.status });
    }
    const code =
      payload.code ?? (response.status === 404 ? "NOT_FOUND"
      : response.status === 409 ? "CONFLICT"
      : response.status === 429 ? "RATE_LIMITED"
      : response.status === 401 || response.status === 403 ? "SESSION_UNAVAILABLE"
      : "PERSISTENCE_FAILURE");
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

  const uploadReceipt = async (
    expenseIdValue: ExpenseId,
    receipt: NonNullable<Parameters<ExpenseApplicationActions["createExpense"]>[0]["receipts"]>[number],
    fallbackKey: string,
  ): Promise<void> => {
    const retryKey = `/api/app/receipt-upload:${fallbackKey}`;
    const receiptCommandId = receipt.commandId ?? retryCommandIds.get(retryKey) ?? crypto.randomUUID();
    retryCommandIds.set(retryKey, String(receiptCommandId));
    const bytes = receipt.content.bytes;
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await requestJson<ReceiptView>("/api/app/receipt-upload", {
      method: "POST",
      headers: {
        "content-type": receipt.content.mimeType,
        "x-command-id": String(receiptCommandId),
        "x-expense-id": String(expenseIdValue),
        ...(receipt.originalFilename ? { "x-receipt-filename": encodeURIComponent(receipt.originalFilename) } : {}),
      },
      body,
    });
  };

  const removeReceipt = async (receiptIdValue: string, receiptCommandId: string): Promise<void> => {
    await requestJson("/api/app/receipt-remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiptId: receiptIdValue, commandId: receiptCommandId }),
    });
  };

  const finishReceiptSagas = async (
    expenseIdValue: ExpenseId,
    additions: NonNullable<Parameters<ExpenseApplicationActions["createExpense"]>[0]["receipts"]>,
    removals: readonly string[],
    removalCommandIds: Readonly<Record<string, string>>,
  ): Promise<void> => {
    let failures = 0;
    for (const receiptIdValue of removals) {
      const retryKey = `/api/app/receipt-remove:${receiptIdValue}`;
      const receiptCommandId = removalCommandIds[receiptIdValue] ?? retryCommandIds.get(retryKey) ?? crypto.randomUUID();
      retryCommandIds.set(retryKey, receiptCommandId);
      try {
        await removeReceipt(receiptIdValue, receiptCommandId);
      } catch {
        failures += 1;
      }
    }
    for (const [index, receipt] of additions.entries()) {
      try {
        await uploadReceipt(expenseIdValue, receipt, `${String(expenseIdValue)}:${index}:${String(receipt.commandId ?? "fallback")}`);
      } catch {
        failures += 1;
      }
    }
    await refresh();
    if (failures > 0) throw new ReceiptSagaPartialSuccessError(String(expenseIdValue), failures);
  };

  const readReceiptContent = async (receiptIdValue: string): Promise<ExpenseReceiptContent> => {
    const response = await fetch(`/api/app/receipts/${encodeURIComponent(receiptIdValue)}/content`, {
      headers: { accept: "image/jpeg, image/png, image/webp" },
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text();
      const payload = text ? parseWithBigInt<{ error?: string; code?: ApplicationErrorCode }>(text) : {};
      throw Object.assign(new ApplicationError(payload.code ?? "NOT_FOUND", payload.error ?? "Receipt not found."), { status: response.status });
    }
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0];
    if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
      throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "The stored Receipt could not be read safely.");
    }
    return Object.freeze({ bytes: new Uint8Array(await response.arrayBuffer()), mimeType });
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
    createExpense: async (command: Parameters<ExpenseApplicationActions["createExpense"]>[0]) => {
      const { receipts = [], ...expenseCommand } = command;
      const result = await requestJson<ExpenseView>("/api/app/expense-create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...expenseCommand, receipts: [] }),
      });
      await finishReceiptSagas(result.expense.expenseId, receipts, [], {});
      return result;
    },
    editExpense: async (command: Parameters<ExpenseApplicationActions["editExpense"]>[0]) => {
      const {
        newReceipts = [],
        removedReceiptIds = [],
        receiptRemovalCommandIds = {},
        ...expenseCommand
      } = command;
      const result = await requestJson<ExpenseView>("/api/app/expense-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...expenseCommand, newReceipts: [], removedReceiptIds: [] }),
      });
      await finishReceiptSagas(
        result.expense.expenseId,
        newReceipts,
        removedReceiptIds.map(String),
        Object.fromEntries(Object.entries(receiptRemovalCommandIds).map(([key, value]) => [key, String(value)])),
      );
      return result;
    },
    deleteExpense: (expenseIdValue: ExpenseId, expectedRevision: number) =>
      postGeneratedCommand("/api/app/expense-delete", { expenseId: expenseIdValue, expectedRevision }),
    listReceipts: (expenseIdValue: ExpenseId) =>
      requestJson<readonly ReceiptView[]>(`/api/app/expense-receipts?id=${encodeURIComponent(expenseIdValue)}`),
    readReceipt: (receiptIdValue: Parameters<ExpenseApplicationActions["readReceipt"]>[0]) => readReceiptContent(String(receiptIdValue)),
    deleteReceipt: async (receiptIdValue: Parameters<ExpenseApplicationActions["deleteReceipt"]>[0]) => {
      const retryKey = `/api/app/receipt-remove:${String(receiptIdValue)}`;
      const receiptCommandId = retryCommandIds.get(retryKey) ?? crypto.randomUUID();
      retryCommandIds.set(retryKey, receiptCommandId);
      await removeReceipt(String(receiptIdValue), receiptCommandId);
      retryCommandIds.delete(retryKey);
      await refresh();
    },
    listActivity: (expenseIdValue: ExpenseId) =>
      requestJson<readonly ExpenseActivityView[]>(`/api/app/expense-activity?id=${encodeURIComponent(expenseIdValue)}`),
  });

  const settlementActions = Object.freeze<SettlementApplicationActions>({
    getPage: (householdIdValue: HouseholdId) =>
      requestJson<SettlementPageView>(`/api/app/settlements?householdId=${encodeURIComponent(householdIdValue)}`),
    getPendingPreview: (settlementIdValue: SettlementId) =>
      requestJson<PendingSettlementView>(`/api/app/settlement-preview?id=${encodeURIComponent(settlementIdValue)}`),
    markRecommendationPaid: async (recommendation, commandId) => {
      await postCommand("/api/app/settlement-create", { recommendation, commandId });
    },
    confirm: (settlementIdValue) => postGeneratedCommand("/api/app/settlement-confirm", { settlementId: settlementIdValue }),
    reject: (settlementIdValue) => postGeneratedCommand("/api/app/settlement-reject", { settlementId: settlementIdValue }),
    cancel: (settlementIdValue) => postGeneratedCommand("/api/app/settlement-cancel", { settlementId: settlementIdValue }),
  });

  const cardActions: CardApplicationActions = Object.freeze({
    getMyCards: () => requestJson<CardPageView>("/api/app/cards"),
    createMyCard: async (input: Parameters<CardApplicationActions["createMyCard"]>[0]) => {
      const result = await requestJson<MyCardSummaryView>("/api/app/card-create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      await refresh();
      return result;
    },
    updateMyCard: async (
      cardIdValue: Parameters<CardApplicationActions["updateMyCard"]>[0],
      input: Parameters<CardApplicationActions["updateMyCard"]>[1],
    ) => {
      const retryKey = `/api/app/card-edit:${JSON.stringify({ cardId: cardIdValue, ...input })}`;
      const commandId = retryCommandIds.get(retryKey) ?? crypto.randomUUID();
      retryCommandIds.set(retryKey, commandId);
      const result = await requestJson<MyCardSummaryView>("/api/app/card-edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: cardIdValue, ...input, commandId }),
      });
      retryCommandIds.delete(retryKey);
      await refresh();
      return result;
    },
    getRemovalPreview: (cardIdValue: CardId) =>
      requestJson<CardRemovalPreview>(`/api/app/card-removal-preview?id=${encodeURIComponent(cardIdValue)}`),
    deleteOrArchive: async (
      cardIdValue: Parameters<CardApplicationActions["deleteOrArchive"]>[0],
      expectedAction: Parameters<CardApplicationActions["deleteOrArchive"]>[1],
    ) => {
      const intent = { cardId: cardIdValue, expectedAction };
      const retryKey = `/api/app/card-remove:${JSON.stringify(intent)}`;
      const commandId = retryCommandIds.get(retryKey) ?? crypto.randomUUID();
      retryCommandIds.set(retryKey, commandId);
      const result = await requestJson<"deleted" | "archived">("/api/app/card-remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...intent, commandId }),
      });
      retryCommandIds.delete(retryKey);
      await refresh();
      return result;
    },
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
      <DevelopmentToolsSlotsProvider value={undefined}>
        <AppShell>{children}</AppShell>
      </DevelopmentToolsSlotsProvider>
      <Toaster closeButton position="top-right" richColors />
    </ApplicationRuntimeProvider>
  );
}
