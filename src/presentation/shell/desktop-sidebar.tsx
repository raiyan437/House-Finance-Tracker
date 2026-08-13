"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
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
      <div className="px-5 py-6 xl:px-6">
        <Brand />
      </div>
      <nav aria-label="Primary navigation" className="flex-1 px-3 xl:px-4">
        <ul className="grid gap-1">
          {desktopNavigationItems.map((item) => {
            const active = item.isActive(pathname);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-secondary hover:text-foreground",
                  )}
                  href={item.href}
                >
                  <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t p-4 xl:p-5">
        {runtime.status === "ready" ? (
          <Link
            aria-current={pathname.startsWith("/profile") ? "page" : undefined}
            className="block rounded-md p-2 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            href="/profile"
          >
            <MemberRow
              displayName={runtime.session.displayName}
              secondaryText={runtime.session.roleLabel}
              className="[&_p:last-child]:text-text-secondary"
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
          className="mt-2 w-full justify-start text-text-secondary"
          onClick={preventUnavailableAction}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") preventUnavailableAction(event);
          }}
          variant="ghost"
        >
          <LogOut aria-hidden="true" />
          Log Out
        </Button>
        <p
          className="mt-1 px-3 text-caption text-text-secondary"
          id="logout-unavailable-description"
        >
          Authentication is introduced in a later phase.
        </p>
      </div>
    </aside>
  );
}
