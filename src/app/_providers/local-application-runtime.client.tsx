"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalDevelopmentRuntime } from "@/infrastructure/local-runtime.client";
import { LocalDevelopmentRuntime as LocalRuntime } from "@/infrastructure/local-runtime.client";
import {
  ApplicationRuntimeProvider,
  type AnalyticsApplicationActions,
  type ApplicationRuntimeState,
  type CardApplicationActions,
  type CurrentSessionView,
  type ExpenseApplicationActions,
  type HouseholdApplicationActions,
  type ProfileApplicationActions,
  type SettlementApplicationActions,
} from "@/presentation/runtime/application-runtime-context";
import { localCalendarMonthFromInstant } from "@/application/analytics/calendar-month";
import {
  DevelopmentToolsProvider,
  type DevelopmentIdentityOption,
} from "@/presentation/devtools/development-tools";
import { Toaster } from "@/components/ui/sonner";
import { FULL_LOCAL_CAPABILITIES } from "@/application/runtime-capabilities";
import type { UserId } from "@/domain/shared/identifiers";
import type { HouseholdAccessState } from "@/application/services/application-services";

let sharedRuntime: LocalDevelopmentRuntime | undefined;
let sharedRuntimePromise: Promise<LocalDevelopmentRuntime> | undefined;
let runtimeHolders = 0;
let runtimeGeneration = 0;
let scheduledClose: ReturnType<typeof setTimeout> | undefined;

function closeSharedRuntime(): void {
  runtimeGeneration += 1;
  const pendingRuntime = sharedRuntimePromise;
  const openedRuntime = sharedRuntime;
  sharedRuntime = undefined;
  sharedRuntimePromise = undefined;

  openedRuntime?.close();
  if (!openedRuntime && pendingRuntime) {
    void pendingRuntime.then((runtime) => runtime.close()).catch(() => undefined);
  }
}

function acquireRuntime(): Promise<LocalDevelopmentRuntime> {
  runtimeHolders += 1;
  if (scheduledClose) {
    clearTimeout(scheduledClose);
    scheduledClose = undefined;
  }

  if (sharedRuntime) return Promise.resolve(sharedRuntime);
  if (sharedRuntimePromise) return sharedRuntimePromise;

  const generation = ++runtimeGeneration;
  sharedRuntimePromise = LocalRuntime.create()
    .then((runtime) => {
      if (generation !== runtimeGeneration) {
        runtime.close();
        throw new Error("Local runtime initialization was abandoned.");
      }
      sharedRuntime = runtime;
      return runtime;
    })
    .catch((error: unknown) => {
      if (generation === runtimeGeneration) {
        sharedRuntimePromise = undefined;
      }
      throw error;
    });

  return sharedRuntimePromise;
}

function releaseRuntime(): void {
  runtimeHolders = Math.max(0, runtimeHolders - 1);
  if (runtimeHolders !== 0) return;

  scheduledClose = setTimeout(() => {
    scheduledClose = undefined;
    if (runtimeHolders === 0) closeSharedRuntime();
  }, 0);
}

function retryRuntime(): void {
  runtimeHolders = 0;
  if (scheduledClose) clearTimeout(scheduledClose);
  scheduledClose = undefined;
  closeSharedRuntime();
}

async function loadSessionView(
  runtime: LocalDevelopmentRuntime,
): Promise<Readonly<{ session: CurrentSessionView; household: HouseholdAccessState }>> {
  const [profile, household, settlementActionCount] = await Promise.all([
    runtime.application.profiles.getCurrentProfile(),
    runtime.application.households.getCurrentAccessState(),
    runtime.application.settlements.countCurrentUserSettlementActions(),
  ]);
  const isLeader = household.status === "active-leader";
  const isMember = household.status === "active-member";

  return Object.freeze({
    session: Object.freeze({
      userId: profile.userId,
      displayName: profile.displayName,
      displayEmail: profile.displayEmail,
      profileVersion: profile.version,
      roleLabel: isLeader ? "Leader" : isMember ? "Member" : "No active household",
      settlementActionCount,
      ...(isLeader || isMember ? { householdName: household.household.name } : {}),
    }),
    household,
  });
}

interface LocalApplicationRuntimeProps {
  readonly children: React.ReactNode;
}

export function LocalApplicationRuntime({
  children,
}: LocalApplicationRuntimeProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ApplicationRuntimeState>({ status: "loading" });
  const [identities, setIdentities] = useState<readonly DevelopmentIdentityOption[]>([]);
  const runtimeRef = useRef<LocalDevelopmentRuntime | undefined>(undefined);
  const reconstructionRef = useRef(0);

  const retry = useCallback(() => {
    retryRuntime();
    runtimeRef.current = undefined;
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    let actions: HouseholdApplicationActions;
    let expenseActions: ExpenseApplicationActions;
    let settlementActions: SettlementApplicationActions;
    let cardActions: CardApplicationActions;
    let analyticsActions: AnalyticsApplicationActions;
    let profileActions: ProfileApplicationActions;

    async function reconstructState(runtime: LocalDevelopmentRuntime, showLoading = false) {
      const reconstruction = ++reconstructionRef.current;
      if (showLoading && !disposed) setState({ status: "loading" });
      try {
        const view = await loadSessionView(runtime);
        if (!disposed && reconstruction === reconstructionRef.current) {
          setState({
            status: "ready",
            ...view,
            capabilities: FULL_LOCAL_CAPABILITIES,
            householdActions: actions,
            expenseActions,
            settlementActions,
            cardActions,
            analyticsActions,
            profileActions,
          });
        }
      } catch {
        if (!disposed && reconstruction === reconstructionRef.current) {
          setState({
            status: "error",
            message: "The local application data could not be read.",
            retry,
          });
        }
      }
    }

    async function initialize() {
      try {
        const runtime = await acquireRuntime();
        if (disposed) return;
        runtimeRef.current = runtime;
        const mutateAndReconstruct = async <T,>(mutation: () => Promise<T>): Promise<T> => {
          try {
            const result = await mutation();
            await reconstructState(runtime);
            return result;
          } catch (error) {
            await reconstructState(runtime);
            throw error;
          }
        };
        actions = Object.freeze<HouseholdApplicationActions>({
          generateCode: () => runtime.application.households.generateUniqueHouseholdCode(),
          createHousehold: async (name, code, commandId) => {
            await mutateAndReconstruct(() => runtime.application.households.createHousehold(name, code, commandId));
          },
          findHousehold: (code) => runtime.application.households.findHouseholdForJoin(code),
          requestToJoin: async (householdId, commandId) => {
            await mutateAndReconstruct(() => runtime.application.households.requestToJoin(householdId, commandId));
          },
          cancelJoinRequest: (joinRequestId) => mutateAndReconstruct(() => runtime.application.households.cancelJoinRequest(joinRequestId)),
          acceptJoinRequest: (joinRequestId) => mutateAndReconstruct(() => runtime.application.households.acceptJoinRequest(joinRequestId)),
          rejectJoinRequest: (joinRequestId) => mutateAndReconstruct(() => runtime.application.households.rejectJoinRequest(joinRequestId)),
          leaveHousehold: () => mutateAndReconstruct(() => runtime.application.households.leaveCurrentHousehold()),
          renameHousehold: async (name) => {
            await mutateAndReconstruct(() => runtime.application.households.renameHousehold(name));
          },
          removeMember: (memberId) => mutateAndReconstruct(() => runtime.application.households.removeMember(memberId)),
          transferLeadership: (memberId) => mutateAndReconstruct(() => runtime.application.households.transferLeadership(memberId)),
          deleteHousehold: () => mutateAndReconstruct(() => runtime.application.households.deleteCurrentHousehold()),
          refresh: () => reconstructState(runtime, true),
        });
        expenseActions = Object.freeze<ExpenseApplicationActions>({
          getCurrentBusinessDate: async () => runtime.application.expenses.currentBusinessDate(),
          getMyAvailableReceiptBytes: () => runtime.application.receipts.getMyAvailableReceiptBytes(),
          listExpenses: (householdId, includeDeleted) =>
            runtime.application.expenses.listHouseholdExpenses(
              householdId,
              includeDeleted,
            ),
          listMembers: (householdId) =>
            runtime.application.expenses.listHouseholdMembers(householdId),
          listSelectableCards: () =>
            runtime.application.cards.listMySelectableCards(),
          getExpense: (expenseId) =>
            runtime.application.expenses.getExpense(expenseId),
          createExpense: (command) =>
            runtime.application.expenses.createExpense(command),
          editExpense: (command) =>
            runtime.application.expenses.editExpense(command),
          deleteExpense: (expenseId, expectedRevision) =>
            runtime.application.expenses.deleteExpense(expenseId, expectedRevision),
          listReceipts: (expenseId) =>
            runtime.application.receipts.listExpenseReceipts(expenseId),
          readReceipt: (receiptId) =>
            runtime.application.receipts.readReceipt(receiptId),
          deleteReceipt: (receiptId) =>
            runtime.application.receipts.deleteReceipt(receiptId),
          listActivity: (expenseId) =>
            runtime.application.expenses.listExpenseActivity(expenseId),
        });
        settlementActions = Object.freeze<SettlementApplicationActions>({
          getPage: (householdId) =>
            runtime.application.settlements.getSettlementPage(householdId),
          getPendingPreview: (settlementId) =>
            runtime.application.settlements.getPendingSettlementActionPreview(settlementId),
          markRecommendationPaid: async (recommendation, commandId) => {
            await mutateAndReconstruct(() =>
              runtime.application.settlements.createSettlement(recommendation, commandId),
            );
          },
          confirm: (settlementId) =>
            mutateAndReconstruct(() =>
              runtime.application.settlements.confirmSettlement(settlementId),
            ),
          reject: (settlementId) =>
            mutateAndReconstruct(() =>
              runtime.application.settlements.rejectSettlement(settlementId),
            ),
          cancel: (settlementId) =>
            mutateAndReconstruct(() =>
              runtime.application.settlements.cancelSettlement(settlementId),
            ),
        });
        cardActions = Object.freeze<CardApplicationActions>({
          getMyCards: () => runtime.application.cards.getMyCards(),
          createMyCard: (input) => runtime.application.cards.createMyCard(input),
          updateMyCard: (cardId, input) => runtime.application.cards.updateMyCard(cardId, input),
          getRemovalPreview: (cardId) => runtime.application.cards.getMyCardRemovalPreview(cardId),
          deleteOrArchive: (cardId, expectedAction) =>
            runtime.application.cards.deleteOrArchiveMyCard(cardId, expectedAction),
        });
        analyticsActions = Object.freeze<AnalyticsApplicationActions>({
          getDashboard: (householdId, month) =>
            runtime.application.analytics.getDashboard(householdId, month),
          getMonthlyReport: (householdId, month) =>
            runtime.application.analytics.getMonthlyReport(
              householdId,
              month,
              localCalendarMonthFromInstant,
            ),
        });
        profileActions = Object.freeze<ProfileApplicationActions>({
          updateDisplayName: async (displayName, expectedVersion, commandId) => {
            await mutateAndReconstruct(() => runtime.application.profiles.updateCurrentProfile(displayName, expectedVersion, commandId));
          },
          replaceAvatar: async () => {
            throw new Error("Profile pictures require the production private Storage service.");
          },
        });
        unsubscribe = runtime.currentSession.subscribe(() => {
          void reconstructState(runtime, true);
        });
        await reconstructState(runtime);

        if (process.env.NODE_ENV === "development") {
          const profiles = await runtime.listDevelopmentIdentities();
          if (!disposed) {
            setIdentities(
              profiles.map(({ userId, displayName }) => ({ userId, displayName })),
            );
          }
        }
      } catch {
        if (!disposed) {
          setState({
            status: "error",
            message: "The local application could not be started.",
            retry,
          });
        }
      }
    }

    function handlePageHide() {
      retryRuntime();
      runtimeRef.current = undefined;
    }

    void initialize();
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      disposed = true;
      unsubscribe?.();
      window.removeEventListener("pagehide", handlePageHide);
      runtimeRef.current = undefined;
      releaseRuntime();
    };
  }, [attempt, retry]);

  const switchIdentity = useCallback(async (userId: UserId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    await runtime.currentSession.switchIdentity(userId);
  }, []);

  return (
    <ApplicationRuntimeProvider value={state}>
      <DevelopmentToolsProvider
        value={process.env.NODE_ENV === "development" && state.status === "ready"
          ? {
              currentUserId: state.session.userId,
              identities,
              onSwitchIdentity: switchIdentity,
            }
          : undefined}
      >
        {children}
      </DevelopmentToolsProvider>
      <Toaster closeButton position="top-right" richColors />
    </ApplicationRuntimeProvider>
  );
}
