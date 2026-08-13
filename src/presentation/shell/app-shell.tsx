"use client";

import { Button } from "@/components/ui/button";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileNavigation } from "./mobile-navigation";

interface AppShellProps {
  readonly children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const runtime = useApplicationRuntime();

  return (
    <div
      className="min-h-svh lg:grid lg:grid-cols-[var(--sidebar-laptop)_minmax(0,1fr)] xl:grid-cols-[var(--sidebar-desktop)_minmax(0,1fr)]"
      data-runtime-state={runtime.status}
      data-slot="app-shell"
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <DesktopSidebar />
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
          {children}
        </main>
      </div>
      <MobileNavigation />
    </div>
  );
}
