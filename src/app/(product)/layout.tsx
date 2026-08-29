import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SelectedApplicationRuntime } from "@/app/_providers/selected-application-runtime.client";

const composition = process.env.APP_COMPOSITION === "appwrite" ? "appwrite" : "local";

export default function ProductLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <TooltipProvider delayDuration={300}>
      <SelectedApplicationRuntime composition={composition}>
        {children}
      </SelectedApplicationRuntime>
    </TooltipProvider>
  );
}
