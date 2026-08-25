import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocalApplicationRuntime } from "@/app/_providers/local-application-runtime.client";
import { ProductionSessionProvider } from "@/app/_providers/production-session-provider.client";
import { AppShell } from "@/presentation/shell/app-shell";

const composition = process.env.APP_COMPOSITION ?? "local";

export default function ProductLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (composition === "appwrite") {
    return (
      <TooltipProvider delayDuration={300}>
        <ProductionSessionProvider />
      </TooltipProvider>
    );
  }
  return (
    <LocalApplicationRuntime>
      <TooltipProvider delayDuration={300}>
        <AppShell>{children}</AppShell>
      </TooltipProvider>
    </LocalApplicationRuntime>
  );
}
