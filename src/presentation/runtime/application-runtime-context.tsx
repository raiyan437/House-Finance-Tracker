"use client";

import { createContext, useContext } from "react";
import type {
  HouseholdAccessState,
  JoinableHouseholdView,
} from "@/application/services/application-services";
import type {
  HouseholdId,
  JoinRequestId,
  UserId,
} from "@/domain/shared/identifiers";

export interface CurrentSessionView {
  readonly userId: UserId;
  readonly displayName: string;
  readonly displayEmail: string;
  readonly roleLabel: "Leader" | "Member" | "No active household";
  readonly householdName?: string;
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

export type ApplicationRuntimeState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      session: CurrentSessionView;
      household: HouseholdAccessState;
      householdActions: HouseholdApplicationActions;
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
