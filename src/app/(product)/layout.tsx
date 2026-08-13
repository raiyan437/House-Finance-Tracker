import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocalApplicationRuntime } from "@/app/_providers/local-application-runtime.client";
import { AppShell } from "@/presentation/shell/app-shell";

export default function ProductLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <LocalApplicationRuntime>
      <TooltipProvider delayDuration={300}>
        <AppShell>{children}</AppShell>
      </TooltipProvider>
    </LocalApplicationRuntime>
  );
}
