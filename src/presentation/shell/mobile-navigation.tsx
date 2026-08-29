"use client";

import Link from "next/link";
import {
  CirclePlus,
  Ellipsis,
  HandCoins,
  LayoutDashboard,
  ReceiptText,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { useDevelopmentToolsSlots } from "@/presentation/devtools/development-tools-slots";
import { moreNavigationItems } from "./navigation-items";

interface MobileLinkProps {
  readonly href: string;
  readonly label: string;
  readonly active: boolean;
  readonly icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  readonly emphasized?: boolean;
  readonly actionCount?: number;
}

function MobileLink({
  href,
  label,
  active,
  icon: Icon,
  emphasized = false,
  actionCount = 0,
}: MobileLinkProps) {
  return (
    <Link
      aria-label={actionCount > 0
        ? `${label}, ${actionCount} ${actionCount === 1 ? "action" : "actions"} waiting for you`
        : label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-14 min-w-0 items-center justify-center rounded-md px-1 text-caption font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        active && "text-foreground",
      )}
      href={href}
      title={label}
    >
        <span
          className={cn(
            "relative flex size-7 items-center justify-center rounded-md",
            emphasized && "size-10 bg-brand text-foreground shadow-[var(--shadow-small)]",
            active && !emphasized && "bg-brand-soft text-foreground",
          )}
        >
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
        {actionCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-fine font-semibold leading-5 text-foreground"
          >
            {actionCount}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function MobileNavigation() {
  const pathname = usePathname();
  const runtime = useApplicationRuntime();
  const developmentTools = useDevelopmentToolsSlots();
  const moreActive = moreNavigationItems.some((item) => item.isActive(pathname));
  const settlementActionCount = runtime.status === "ready"
    ? runtime.session.settlementActionCount
    : 0;
  const joinRequestCount = runtime.status === "ready" && runtime.household.status === "active-leader"
    ? runtime.household.joinRequests.length
    : 0;
  const joinRequestBadgeLabel = `${joinRequestCount} join request${joinRequestCount === 1 ? "" : "s"} waiting for your review`;

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 px-2 shadow-[var(--shadow-small)] backdrop-blur lg:hidden"
      suppressHydrationWarning
    >
      <div
        className="grid grid-cols-5 items-start"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <MobileLink
          active={pathname === "/dashboard"}
          href="/dashboard"
          icon={LayoutDashboard}
          label="Dashboard"
        />
        <MobileLink
          active={pathname === "/expenses"}
          href="/expenses"
          icon={ReceiptText}
          label="Expenses"
        />
        <MobileLink
          active={pathname === "/expenses/new"}
          emphasized
          href="/expenses/new"
          icon={CirclePlus}
          label="Add"
        />
        <MobileLink
          active={pathname.startsWith("/settlements")}
          actionCount={settlementActionCount}
          href="/settlements"
          icon={HandCoins}
          label="Settlements"
        />
        <Sheet>
          <SheetTrigger asChild>
            <button
              aria-label={joinRequestCount > 0 && settlementActionCount > 0 ? `More, ${settlementActionCount} payments to confirm, ${joinRequestBadgeLabel}` : joinRequestCount > 0 ? `More, ${joinRequestBadgeLabel}` : settlementActionCount > 0 ? `More, ${settlementActionCount} payments to confirm` : "More"}
              aria-current={moreActive ? "page" : undefined}
              className={cn(
                "flex min-h-14 min-w-0 items-center justify-center rounded-md px-1 text-caption font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                moreActive && "text-foreground",
              )}
              title="More"
              type="button"
            >
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-md",
                  moreActive && "bg-brand-soft text-foreground",
                )}
              >
                <Ellipsis aria-hidden="true" className="size-5" strokeWidth={1.8} />
                {joinRequestCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-2 -top-2 inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-fine font-semibold leading-5 text-foreground"
                  >
                    {joinRequestCount}
                  </span>
                ) : null}
              </span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader className="border-b p-6">
              <SheetTitle>More</SheetTitle>
              <SheetDescription>Additional House Finance destinations.</SheetDescription>
            </SheetHeader>
            <nav aria-label="More navigation" className="grid gap-2 p-4 pb-8">
              {moreNavigationItems.map((item) => {
                const Icon = item.icon;
                const active = item.isActive(pathname);

                return (
                  <SheetClose asChild key={item.href}>
                    <Link
                      aria-current={active ? "page" : undefined}
                      aria-label={item.href === "/household" && joinRequestCount > 0
                        ? `${item.label}, ${joinRequestBadgeLabel}`
                        : undefined}
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-md px-4 text-sm font-medium text-text-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                        active ? "bg-brand-soft text-foreground" : "hover:bg-secondary",
                      )}
                      href={item.href}
                    >
                      <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
                      {item.label}
                      {item.href === "/household" && joinRequestCount > 0 ? (
                        <span
                          aria-hidden="true"
                          className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-fine font-semibold leading-5 text-foreground"
                        >
                          {joinRequestCount}
                        </span>
                      ) : null}
                      {item.href === "/settlements" && settlementActionCount > 0 ? (
                        <span
                          aria-hidden="true"
                          className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-fine font-semibold leading-5 text-foreground"
                        >
                          {settlementActionCount}
                        </span>
                      ) : null}
                    </Link>
                  </SheetClose>
                );
              })}
            </nav>
            {developmentTools?.mobile}
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
