"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ApplicationError, ReceiptSagaPartialSuccessError } from "@/application/errors/application-error";
import type { ProductCapabilities } from "@/application/runtime-capabilities";
import type { CalendarMonth } from "@/application/analytics/calendar-month";
import { requestJson as transportJson, requestResponse, SESSION_EXPIRED_EVENT, FORBIDDEN_EVENT, BEFORE_WRITE_EVENT } from "@/presentation/runtime/production-transport";
import { toast } from "sonner";
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
  ExpenseCommentView,
  JoinableHouseholdView,
  ReceiptView,
  ExpenseReceiptContent,
} from "@/application/services/application-services";
import type { ExpenseDate } from "@/domain/dates/expense-date";
import type { CardId, CommandId, ExpenseId, HouseholdId, JoinRequestId, SettlementId, UserId, NotificationId } from "@/domain/shared/identifiers";
import type { NotificationLatestView, NotificationMarkAllReadView, NotificationPageView } from "@/domain/notifications/notification-types";
import { Surface } from "@/presentation/components/surface";
import {
  ApplicationRuntimeProvider,
  type AnalyticsApplicationActions,
  type ApplicationRuntimeState,
  type CardApplicationActions,
  type ExpenseApplicationActions,
  type HouseholdApplicationActions,
  type ProfileApplicationActions,
  type SettlementApplicationActions,
  type NotificationApplicationActions,
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

function LoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background" role="status" aria-label="Loading">
      <div className="grid gap-3 text-center text-body text-text-muted">Loading…</div>
    </main>
  );
}

function AnonymousRedirect({ expired }: Readonly<{ expired: boolean }>) {
  const router = useRouter();
  useEffect(() => {
    router.replace(expired ? "/login?sessionExpired=1" : "/login");
  }, [router, expired]);
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
  requestJson: typeof transportJson,
  readSignal: AbortSignal,
  retryCommandIds: Map<string, string>,
): ApplicationRuntimeState {
  const { session, household, capabilities, businessDate } = bootstrap;

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
    }, { continuation: true });
  };

  const removeReceipt = async (receiptIdValue: string, receiptCommandId: string, continuation = false): Promise<void> => {
    await requestJson("/api/app/receipt-remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiptId: receiptIdValue, commandId: receiptCommandId }),
    }, { continuation });
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
        await removeReceipt(receiptIdValue, receiptCommandId, true);
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
    const response = await requestResponse(`/api/app/receipts/${encodeURIComponent(receiptIdValue)}/content`, {
      headers: { accept: "image/jpeg, image/png, image/webp" },
      cache: "no-store",
    }, { signal: readSignal });
    if (!response.ok) {
      throw Object.assign(new ApplicationError(response.status === 401 ? "SESSION_UNAVAILABLE" : "PERSISTENCE_FAILURE", response.status === 401 ? "Sign in to continue." : "Receipt could not be loaded. Please retry."), { status: response.status });
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
    listComments: (expenseIdValue: ExpenseId) =>
      requestJson<readonly ExpenseCommentView[]>(`/api/app/expense-comments?id=${encodeURIComponent(expenseIdValue)}`),
    createComment: (expenseIdValue: ExpenseId, body: string, commentCommandId: CommandId) =>
      requestJson<ExpenseCommentView>("/api/app/expense-comment-create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expenseId: expenseIdValue, body, commandId: commentCommandId }) }),
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

  const profileActions: ProfileApplicationActions = Object.freeze({
    updateDisplayName: async (displayName: string, expectedVersion: number, commandId: CommandId) => {
      try {
        await postCommand("/api/app/profile-display-name", { displayName, expectedVersion, commandId });
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "PROFILE_VERSION_CONFLICT") await refresh();
        throw error;
      }
    },
    replaceAvatar: async (file: File, expectedVersion: number, commandId: CommandId) => {
      try {
        await requestJson("/api/app/profile-avatar", {
          method: "POST",
          headers: {
            "content-type": file.type,
            "x-command-id": commandId,
            "x-profile-version": String(expectedVersion),
          },
          body: file,
        });
        await refresh();
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "PROFILE_VERSION_CONFLICT") await refresh();
        throw error;
      }
    },
  });

  const notificationActions: NotificationApplicationActions = Object.freeze({
    latest: () => requestJson<NotificationLatestView>("/api/app/notifications/latest"),
    page: (offset = 0) => requestJson<NotificationPageView>(`/api/app/notifications?offset=${encodeURIComponent(String(offset))}`),
    markRead: (notificationId: NotificationId) => requestJson("/api/app/mark-notification-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationId }),
    }).then(() => undefined),
    markAllRead: () => requestJson<NotificationMarkAllReadView>("/api/app/notifications/mark-all-read", { method: "POST" }),
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
    profileActions,
    notificationActions,
  });
}

export function ProductionApplicationRuntime({ children }: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<ApplicationRuntimeState>({ status: "loading" });
  const [anonymous, setAnonymous] = useState<{ expired: boolean }>();
  const [connection, setConnection] = useState<"checking" | "ready" | "unavailable">("checking");
  const refreshRef = useRef<(saved?: boolean) => Promise<void>>(async () => undefined);

  useEffect(() => {
    let disposed = false;
    let invalidated = false;
    let hadReadyState = false;
    let currentConnection: typeof connection = "checking";
    let inFlight: Promise<void> | undefined;
    let refreshAgain = false;
    let savedAction = false;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const readController = new AbortController();
    const retryCommandIds = new Map<string, string>();
    const live = () => !disposed && !invalidated;
    const updateConnection = (next: typeof connection) => {
      currentConnection = next;
      if (live()) setConnection(next);
    };
    const invalidate = (expired: boolean) => {
      if (!live()) return;
      invalidated = true;
      readController.abort();
      clearTimeout(scheduled);
      retryCommandIds.clear();
      setAnonymous({ expired });
      setState({ status: "loading" });
    };
    const onExpired = () => invalidate(hadReadyState);
    const onBeforeWrite = (event: Event) => {
      if (!live() || currentConnection !== "ready") event.preventDefault();
    };
    const requestJson: typeof transportJson = (path, init, options) => transportJson(path, init, {
      ...options,
      ...((init?.method ?? "GET").toUpperCase() === "GET" ? { signal: readController.signal } : {}),
    });
    const signOut = async () => {
      invalidate(false);
      try {
        await transportJson("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      } catch {
        toast.warning("Signed out of this page. Remote sign-out could not be confirmed; retry signing out when connected.");
      }
    };
    const refresh = (saved = false): Promise<void> => {
      if (!live()) return Promise.resolve();
      savedAction ||= saved;
      if (inFlight) {
        // A mutation may complete after an earlier focus check began.
        refreshAgain ||= saved;
        return inFlight;
      }
      clearTimeout(scheduled);
      scheduled = undefined;
      updateConnection("checking");
      inFlight = (async () => {
        do {
          refreshAgain = false;
          try {
            const bootstrap = await requestJson<ProductionBootstrapPayload>("/api/app/bootstrap");
            if (!live()) return;
            hadReadyState = true;
            setState(buildReadyState(bootstrap, signOut, () => refresh(true), requestJson, readController.signal, retryCommandIds));
            updateConnection("ready");
          } catch {
            if (!live()) return;
            updateConnection("unavailable");
            if (!hadReadyState) setState({ status: "error", message: "Your data could not be loaded right now.", retry: () => void refresh() });
            if (savedAction) toast.warning("Your action was saved, but the view could not refresh. Retry the connection to load the current state.");
          }
        } while (refreshAgain && live());
        savedAction = false;
      })().finally(() => { inFlight = undefined; });
      return inFlight;
    };
    const scheduleRefresh = () => {
      if (!live() || document.visibilityState === "hidden" || inFlight || scheduled !== undefined) return;
      updateConnection("checking");
      scheduled = setTimeout(() => { scheduled = undefined; void refresh(); }, 500);
    };
    const onForbidden = (event: Event) => {
      if ((event as CustomEvent<{ path: string }>).detail?.path !== "/api/app/bootstrap") scheduleRefresh();
    };
    refreshRef.current = refresh;
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    window.addEventListener(BEFORE_WRITE_EVENT, onBeforeWrite);
    window.addEventListener(FORBIDDEN_EVENT, onForbidden);
    window.addEventListener("focus", scheduleRefresh);
    window.addEventListener("pageshow", scheduleRefresh);
    window.addEventListener("online", scheduleRefresh);
    document.addEventListener("visibilitychange", scheduleRefresh);
    void refresh();
    return () => {
      disposed = true;
      readController.abort();
      clearTimeout(scheduled);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      window.removeEventListener(BEFORE_WRITE_EVENT, onBeforeWrite);
      window.removeEventListener(FORBIDDEN_EVENT, onForbidden);
      window.removeEventListener("focus", scheduleRefresh);
      window.removeEventListener("pageshow", scheduleRefresh);
      window.removeEventListener("online", scheduleRefresh);
      document.removeEventListener("visibilitychange", scheduleRefresh);
    };
  }, []);

  if (anonymous) return <AnonymousRedirect expired={anonymous.expired} />;
  if (state.status === "error") return <UnavailableScreen onRetry={() => void refreshRef.current()} />;
  if (state.status !== "ready") return <LoadingScreen />;

  return (
    <ApplicationRuntimeProvider value={state}>
      <DevelopmentToolsSlotsProvider value={undefined}>
        <AppShell>
          {connection !== "ready" ? <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-secondary px-4 py-3 text-sm" role="status" aria-live="polite">
            <p>{connection === "checking" ? "Checking your connection. Please wait before saving." : "Connection unavailable. Your draft is still here. Reconnect before saving."}</p>
            {connection === "unavailable" ? <Button type="button" variant="outline" onClick={() => void refreshRef.current()}>Retry connection</Button> : null}
          </div> : null}
          {children}
        </AppShell>
      </DevelopmentToolsSlotsProvider>
      <Toaster closeButton position="top-right" richColors />
    </ApplicationRuntimeProvider>
  );
}
