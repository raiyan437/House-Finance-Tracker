"use client";

import { createContext, useContext } from "react";
import type { UserId } from "@/domain/shared/identifiers";

export interface CurrentSessionView {
  readonly userId: UserId;
  readonly displayName: string;
  readonly displayEmail: string;
  readonly roleLabel: "Leader" | "Member" | "No active household";
  readonly householdName?: string;
}

export type ApplicationRuntimeState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      session: CurrentSessionView;
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
