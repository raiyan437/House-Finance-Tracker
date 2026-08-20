"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MemberRow } from "@/presentation/components/member-row";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { Brand } from "./brand";
import { desktopNavigationItems } from "./navigation-items";

function preventUnavailableAction(event: React.SyntheticEvent) {
  event.preventDefault();
}

export function DesktopSidebar() {
  const pathname = usePathname();
  const runtime = useApplicationRuntime();

  return (
    <aside className="sticky top-0 hidden h-svh border-r bg-sidebar lg:flex lg:flex-col">
      <div className="px-6 pb-10 pt-7">
        <Brand />
      </div>
      <nav aria-label="Primary navigation" className="flex-1 px-4 pt-2">
        <ul className="grid gap-2">
          {desktopNavigationItems.map((item) => {
            const active = item.isActive(pathname);
            const Icon = item.icon;
            const actionCount = item.href === "/settlements" && runtime.status === "ready"
              ? runtime.session.settlementActionCount
              : 0;

            return (
              <li key={item.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                    active
                      ? "bg-foreground text-white"
                      : "hover:bg-secondary hover:text-foreground",
                  )}
                  href={item.href}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn("size-4", active && "text-brand")}
                    strokeWidth={1.8}
                  />
                  <span>{item.label}</span>
                  {actionCount > 0 ? (
                    <span
                      aria-label={`${actionCount} settlement ${actionCount === 1 ? "action" : "actions"} waiting for you`}
                      className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[0.6875rem] font-semibold leading-5 text-foreground"
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
      <div className="border-t px-4 pb-12 pt-5">
        <p className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          Account
        </p>
        {runtime.status === "ready" ? (
          <Link
            aria-current={pathname.startsWith("/profile") ? "page" : undefined}
            className="flex h-[74px] items-center rounded-2xl border bg-secondary px-3 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            href="/profile"
          >
            <MemberRow
              displayName={runtime.session.displayName}
              secondaryText={runtime.session.roleLabel}
              className="w-full [&_[data-slot=avatar]]:size-[42px] [&_p:first-child]:text-[13px] [&_p:last-child]:text-[11px] [&_p:last-child]:text-text-muted"
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
          aria-describedby="logout-unavailable-description"
          aria-disabled="true"
          className="mt-4 h-10 w-full justify-center rounded-xl bg-foreground text-[13px] font-semibold text-white hover:bg-foreground/90 aria-disabled:cursor-not-allowed aria-disabled:opacity-100"
          onClick={preventUnavailableAction}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") preventUnavailableAction(event);
          }}
          variant="default"
        >
          Log Out
        </Button>
        <p
          className="sr-only"
          id="logout-unavailable-description"
        >
          Authentication is introduced in a later phase.
        </p>
      </div>
    </aside>
  );
}
