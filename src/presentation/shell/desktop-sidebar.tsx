"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MemberRow } from "@/presentation/components/member-row";
import { useDevelopmentToolsSlots } from "@/presentation/devtools/development-tools-slots";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { Brand } from "./brand";
import { desktopNavigationItems } from "./navigation-items";

interface DesktopSidebarProps {
  readonly collapsed?: boolean;
  readonly onToggle?: () => void;
}

function SidebarToggle({
  collapsed,
  onToggle,
  className,
}: {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly className?: string;
}) {
  return (
    <Button
      aria-controls="desktop-sidebar"
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        "z-10 rounded-md text-text-secondary transition-[background-color,color,opacity] duration-200 ease-[var(--motion-ease-out)] hover:text-foreground",
        collapsed
          ? "invisible pointer-events-none absolute inset-0 size-10 opacity-0 group-hover/sidebar-logo:pointer-events-auto group-hover/sidebar-logo:visible group-hover/sidebar-logo:opacity-100 group-focus-within/sidebar-logo:pointer-events-auto group-focus-within/sidebar-logo:visible group-focus-within/sidebar-logo:opacity-100"
          : "ml-auto size-9",
        className,
      )}
      onClick={onToggle}
      size="icon-sm"
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      type="button"
      variant="ghost"
    >
      {collapsed ? (
        <PanelLeftOpen aria-hidden="true" />
      ) : (
        <PanelLeftClose aria-hidden="true" />
      )}
    </Button>
  );
}

export function DesktopSidebar({ collapsed, onToggle }: DesktopSidebarProps = {}) {
  const pathname = usePathname();
  const runtime = useApplicationRuntime();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isControlled = collapsed !== undefined;
  const isCollapsed = isControlled ? collapsed : internalCollapsed;
  const developmentTools = useDevelopmentToolsSlots();
  const canSignOut = runtime.status === "ready" && typeof runtime.signOut === "function";
  const joinRequestCount = runtime.status === "ready" && runtime.household.status === "active-leader"
    ? runtime.household.joinRequests.length
    : 0;

  function toggleSidebar() {
    if (onToggle) {
      onToggle();
      return;
    }
    setInternalCollapsed((current) => !current);
  }

  return (
    <aside
      className="sticky top-0 hidden h-svh overflow-visible border-r bg-sidebar lg:flex lg:flex-col"
      data-sidebar-collapsed={isCollapsed}
      id="desktop-sidebar"
    >
      <div
        className={cn(
          "relative flex pb-10 pt-7 transition-[padding] duration-300 ease-[var(--motion-ease-out)]",
          isCollapsed ? "justify-center px-2" : "px-6",
        )}
      >
        <div className={cn("relative size-10 shrink-0", isCollapsed && "group/sidebar-logo")}>
          <Brand
            className={cn(
              isCollapsed &&
                "transition-opacity duration-200 group-hover/sidebar-logo:opacity-0 group-focus-within/sidebar-logo:opacity-0",
            )}
            compact={isCollapsed}
          />
          {isCollapsed ? (
            <SidebarToggle collapsed onToggle={toggleSidebar} />
          ) : null}
        </div>
        {!isCollapsed ? (
          <SidebarToggle collapsed={false} onToggle={toggleSidebar} />
        ) : null}
      </div>
      <nav
        aria-label="Primary navigation"
        className={cn(
          "flex-1 pt-2 transition-[padding] duration-300 ease-[var(--motion-ease-out)]",
          isCollapsed ? "px-2" : "px-4",
        )}
      >
        <ul className="grid gap-2">
          {desktopNavigationItems.map((item) => {
            const active = item.isActive(pathname);
            const Icon = item.icon;
            const actionCount = item.href === "/settlements" && runtime.status === "ready"
              ? runtime.session.settlementActionCount
              : item.href === "/household"
                ? joinRequestCount
                : 0;

            return (
              <li key={item.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  aria-label={isCollapsed ? item.label : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-3 rounded-xl px-3 text-row font-medium text-text-secondary transition-[background-color,color,gap,padding] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                    isCollapsed && "justify-center gap-0 px-2",
                    active
                      ? "bg-foreground text-white"
                      : "hover:bg-secondary hover:text-foreground",
                  )}
                  href={item.href}
                  prefetch={false}
                  title={isCollapsed ? item.label : undefined}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn("size-4", active && "text-brand")}
                    strokeWidth={1.8}
                  />
                  <span
                    aria-hidden={isCollapsed}
                    className={cn(
                      "overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-[var(--motion-ease-out)]",
                      isCollapsed
                        ? "max-w-0 -translate-x-2 opacity-0"
                        : "max-w-32 translate-x-0 opacity-100",
                    )}
                  >
                    {item.label}
                  </span>
                  {actionCount > 0 ? (
                    <span
                      aria-label={item.href === "/household"
                        ? `${actionCount} join request${actionCount === 1 ? "" : "s"} waiting for your review`
                        : `${actionCount} settlement ${actionCount === 1 ? "action" : "actions"} waiting for you`}
                      className={cn(
                        "inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-fine font-semibold leading-5 text-foreground",
                        isCollapsed
                          ? "absolute -right-1 -top-1"
                          : "ml-auto",
                      )}
                    >
                      {actionCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {developmentTools ? (
        <div
          className={cn(
            "border-t border-warning/30 py-4 transition-[margin,padding] duration-300 ease-[var(--motion-ease-out)]",
            isCollapsed ? "mx-2" : "mx-4",
          )}
        >
          {developmentTools.desktop(isCollapsed)}
        </div>
      ) : null}
      <div
        className={cn(
          "border-t pb-12 pt-5 transition-[padding] duration-300 ease-[var(--motion-ease-out)]",
          isCollapsed ? "px-2" : "px-4",
        )}
      >
        <p
          aria-hidden={isCollapsed}
          className={cn(
            "mb-3 overflow-hidden px-2 text-mini font-semibold uppercase tracking-wide text-text-muted transition-[max-height,opacity,margin] duration-300 ease-[var(--motion-ease-out)]",
            isCollapsed ? "mb-0 max-h-0 opacity-0" : "max-h-6 opacity-100",
          )}
        >
          Account
        </p>
        {runtime.status === "ready" ? (
          <Link
            aria-current={pathname.startsWith("/profile") ? "page" : undefined}
            aria-label={isCollapsed ? `Open profile for ${runtime.session.displayName}` : undefined}
            className={cn(
              "flex h-[74px] items-center rounded-2xl border bg-secondary transition-[padding,background-color] hover:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
              isCollapsed ? "justify-center px-2" : "px-3",
            )}
            href="/profile"
            prefetch={false}
            title={isCollapsed ? `Open profile for ${runtime.session.displayName}` : undefined}
          >
            <MemberRow
              avatarVersion={runtime.session.profileVersion}
              compact={isCollapsed}
              displayName={runtime.session.displayName}
              userId={runtime.capabilities.avatarContentReads ? runtime.session.userId : undefined}
              secondaryText={runtime.session.roleLabel}
              className="w-full [&_[data-slot=avatar]]:size-[42px] [&_p:first-child]:text-row [&_p:last-child]:text-fine [&_p:last-child]:text-text-muted"
            />
          </Link>
        ) : (
          <div aria-label="Loading profile" className="flex items-center gap-3 p-2" role="status">
            <Skeleton className="size-8 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        )}
        <Button
          aria-describedby={canSignOut ? undefined : "logout-unavailable-description"}
          aria-disabled={!canSignOut}
          aria-label="Log Out"
          className={cn(
            "mt-4 h-10 w-full justify-center rounded-xl bg-foreground text-row font-semibold text-white transition-[gap,padding] hover:bg-foreground/90 aria-disabled:cursor-not-allowed aria-disabled:opacity-100",
            isCollapsed ? "gap-0 px-0" : "gap-2",
          )}
          onClick={() => {
            if (canSignOut) void runtime.signOut?.();
          }}
          title={isCollapsed ? "Log Out" : undefined}
          variant="default"
        >
          <LogOut aria-hidden="true" />
          <span
            aria-hidden={isCollapsed}
            className={cn(
              "overflow-hidden transition-[max-width,opacity] duration-300 ease-[var(--motion-ease-out)]",
              isCollapsed ? "max-w-0 opacity-0" : "max-w-20 opacity-100",
            )}
          >
            Log Out
          </span>
        </Button>
        {!canSignOut ? (
          <p
            className="sr-only"
            id="logout-unavailable-description"
          >
            Sign out is unavailable in this runtime.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
