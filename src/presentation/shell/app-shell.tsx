"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileNavigation } from "./mobile-navigation";
import { HouseholdAccessGate } from "@/presentation/runtime/household-access-gate.client";

interface AppShellProps {
  readonly children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const runtime = useApplicationRuntime();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className="min-h-svh transition-[grid-template-columns] duration-300 ease-[var(--motion-ease-out)] lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)] xl:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
      data-runtime-state={runtime.status}
      data-sidebar-collapsed={sidebarCollapsed}
      data-slot="app-shell"
      style={{
        "--sidebar-width": sidebarCollapsed
          ? "4.5rem"
          : "var(--sidebar-laptop)",
      } as React.CSSProperties}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <DesktopSidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((current) => !current)}
      />
      <div className="min-w-0">
        {runtime.status === "error" ? (
          <div className="border-b border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            <div className="mx-auto flex max-w-[var(--content-max)] flex-wrap items-center justify-between gap-3">
              <span>{runtime.message}</span>
              <Button onClick={runtime.retry} size="sm" variant="outline">
                Try again
              </Button>
            </div>
          </div>
        ) : null}
        <main
          className="min-h-svh pb-[calc(var(--mobile-navigation-height)+env(safe-area-inset-bottom)+var(--space-6))] lg:pb-0"
          id="main-content"
          tabIndex={-1}
        >
          <HouseholdAccessGate>{children}</HouseholdAccessGate>
        </main>
      </div>
      <MobileNavigation />
    </div>
  );
}
