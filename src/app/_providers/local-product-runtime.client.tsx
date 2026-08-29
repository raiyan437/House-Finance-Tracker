"use client";

import { LocalApplicationRuntime } from "./local-application-runtime.client";
import { AppShell } from "@/presentation/shell/app-shell";

export function LocalProductRuntime({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <LocalApplicationRuntime>
      <AppShell>{children}</AppShell>
    </LocalApplicationRuntime>
  );
}
