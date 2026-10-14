"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDevelopmentToolsSlots } from "@/presentation/devtools/development-tools-slots";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { desktopNavigationItems } from "./navigation-items";
import { GlassSelection } from "./glass-selection";

export function DesktopSidebar() {
  const pathname = usePathname();
  const runtime = useApplicationRuntime();
  const developmentTools = useDevelopmentToolsSlots();
  const canSignOut = runtime.status === "ready" && typeof runtime.signOut === "function";
  const joinRequestCount = runtime.status === "ready" && runtime.household.status === "active-leader"
    ? runtime.household.joinRequests.length : 0;

  return (
    <aside className="journey-rail fixed left-0 z-20 hidden w-18 overflow-visible lg:flex lg:flex-col" data-sidebar-collapsed="true" id="desktop-sidebar">
      <div className="journey-rail-stack journey-glass-surface">
      <nav aria-label="Primary navigation" className="relative px-2 pt-2">
        <GlassSelection routeKey={pathname} />
        <ul className="grid gap-2">
          {desktopNavigationItems.map((item) => {
            const active = item.isActive(pathname);
            const Icon = item.icon;
            const actionCount = item.href === "/settlements" && runtime.status === "ready"
              ? runtime.session.settlementActionCount : item.href === "/household" ? joinRequestCount : 0;
            return (
              <li key={item.href}>
                <Link aria-current={active ? "page" : undefined} aria-label={item.label} className="relative flex items-center justify-center px-2 text-row font-medium" href={item.href} prefetch={false} title={item.label}>
                  <span className="journey-glass-visual"><Icon aria-hidden="true" className="size-4" strokeWidth={1.8} /></span>
                  {actionCount > 0 ? <span aria-label={item.href === "/household" ? `${actionCount} join request${actionCount === 1 ? "" : "s"} waiting for your review` : `${actionCount} settlement ${actionCount === 1 ? "action" : "actions"} waiting for you`} className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-fine font-semibold leading-5 text-foreground">{actionCount}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="journey-rail-account px-2">
        <Button aria-describedby={canSignOut ? undefined : "logout-unavailable-description"} aria-disabled={!canSignOut} aria-label="Log Out" className="h-11 w-full justify-center gap-0 rounded-full bg-foreground px-0 text-row font-semibold text-white hover:bg-foreground/90 aria-disabled:cursor-not-allowed aria-disabled:opacity-100" onClick={() => { if (canSignOut) void runtime.signOut?.(); }} title="Log Out" variant="default"><span className="journey-glass-visual"><LogOut aria-hidden="true" /></span></Button>
        {!canSignOut ? <p className="sr-only" id="logout-unavailable-description">Sign out is unavailable in this runtime.</p> : null}
      </div>
      </div>
      {developmentTools ? <div className="journey-rail-devtools mx-2 border-t border-warning/30">{developmentTools.desktop(true)}</div> : null}
    </aside>
  );
}
