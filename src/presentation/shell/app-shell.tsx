"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { DesktopSidebar } from "./desktop-sidebar";
import { DesktopHeader } from "./desktop-header";
import { MobileNavigation } from "./mobile-navigation";
import { HouseholdAccessGate } from "@/presentation/runtime/household-access-gate.client";

interface AppShellProps {
  readonly children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const runtime = useApplicationRuntime();
  const pathname = usePathname();
  const routeSurface = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const surface = routeSurface.current;
    if (!surface || typeof window.matchMedia !== "function") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;
    let animation: Animation | undefined;
    let opened = false;
    const openPage = () => {
      // Wait for the arriving page rather than animating only its loading skeleton.
      if (opened || !surface.firstElementChild || surface.querySelector('[data-slot="loading-state"]')) return;
      opened = true;
      observer?.disconnect();
      animation = surface.animate?.(
        [{ transform: "translateY(14px) scale(0.985)" }, { transform: "translateY(0) scale(1)" }],
        { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    };
    const stop = () => { animation?.cancel(); observer?.disconnect(); };
    const observer = new MutationObserver(openPage);
    observer.observe(surface, { childList: true, subtree: true });
    openPage();
    motion.addEventListener?.("change", stop);
    surface.addEventListener("pointerdown", stop, true);
    surface.addEventListener("focusin", stop, true);
    return () => {
      stop();
      motion.removeEventListener?.("change", stop);
      surface.removeEventListener("pointerdown", stop, true);
      surface.removeEventListener("focusin", stop, true);
    };
  }, [pathname]);

  return (
    <div
      className="min-h-svh lg:grid lg:grid-cols-[4.5rem_minmax(0,1fr)]"
      data-runtime-state={runtime.status}
      data-sidebar-collapsed="true"
      data-slot="app-shell"
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <DesktopHeader />
      <DesktopSidebar />
      <div className="min-w-0 lg:col-start-2">
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
          className="min-h-[calc(100svh-72px)] pb-[calc(var(--mobile-navigation-height)+env(safe-area-inset-bottom)+var(--space-6))] lg:min-h-[calc(100svh-88px)] lg:pb-0"
          id="main-content"
          data-feature={pathname.split("/")[1]}
          tabIndex={-1}
        >
          <div data-slot="route-surface" ref={routeSurface}>
            <HouseholdAccessGate>{children}</HouseholdAccessGate>
          </div>
        </main>
      </div>
      <MobileNavigation />
    </div>
  );
}
