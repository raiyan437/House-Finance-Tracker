"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalDevelopmentRuntime } from "@/infrastructure/local-runtime.client";
import { LocalDevelopmentRuntime as LocalRuntime } from "@/infrastructure/local-runtime.client";
import {
  ApplicationRuntimeProvider,
  type ApplicationRuntimeState,
  type CurrentSessionView,
} from "@/presentation/runtime/application-runtime-context";
import {
  DevelopmentTools,
  type DevelopmentIdentityOption,
} from "@/presentation/devtools/development-tools";
import { Toaster } from "@/components/ui/sonner";
import type { UserId } from "@/domain/shared/identifiers";

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
): Promise<CurrentSessionView> {
  const [profile, householdState] = await Promise.all([
    runtime.application.profiles.getCurrentProfile(),
    runtime.application.households.getCurrentHousehold(),
  ]);
  const membership = householdState?.memberships.find(
    (candidate) => candidate.userId === profile.userId && candidate.status === "active",
  );

  return Object.freeze({
    userId: profile.userId,
    displayName: profile.displayName,
    displayEmail: profile.displayEmail,
    roleLabel:
      membership?.role === "leader"
        ? "Leader"
        : membership?.role === "member"
          ? "Member"
          : "No active household",
    ...(householdState ? { householdName: householdState.household.name } : {}),
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

  const retry = useCallback(() => {
    retryRuntime();
    runtimeRef.current = undefined;
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    async function refreshSession(runtime: LocalDevelopmentRuntime) {
      try {
        const session = await loadSessionView(runtime);
        if (!disposed) setState({ status: "ready", session });
      } catch {
        if (!disposed) {
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
        unsubscribe = runtime.currentSession.subscribe(() => {
          void refreshSession(runtime);
        });
        await refreshSession(runtime);

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
      {children}
      {process.env.NODE_ENV === "development" && state.status === "ready" ? (
        <DevelopmentTools
          currentUserId={state.session.userId}
          identities={identities}
          onSwitchIdentity={switchIdentity}
        />
      ) : null}
      <Toaster closeButton position="top-right" richColors />
    </ApplicationRuntimeProvider>
  );
}
