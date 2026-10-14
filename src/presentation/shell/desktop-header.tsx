"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House } from "lucide-react";
import { MemberAvatar } from "@/presentation/components/member-avatar";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";
import { desktopNavigationItems } from "./navigation-items";
import { NotificationBell } from "@/presentation/notifications/notification-bell.client";
import { GlassSelection } from "./glass-selection";

export function DesktopHeader() {
  const pathname = usePathname();
  const runtime = useApplicationRuntime();
  const joinRequests = runtime.status === "ready" && runtime.household.status === "active-leader"
    ? runtime.household.joinRequests.length : 0;
  const notificationContext = runtime.status === "ready"
    ? `${runtime.session.userId}:${runtime.household.status}:${runtime.household.status === "active-leader" || runtime.household.status === "active-member" ? runtime.household.household.householdId : "none"}`
    : undefined;

  return (
    <header className="journey-header">
      <div className="journey-wordmark"><span className="journey-brand-icon"><House aria-hidden="true" className="size-7 shrink-0" strokeWidth={1.8} /></span><span>House Finance Tracker</span></div>
      <nav aria-label="Header navigation" className="journey-top-nav journey-glass-surface">
        <GlassSelection routeKey={pathname} />
        {desktopNavigationItems.map((item) => {
          const count = item.href === "/household" ? joinRequests
            : item.href === "/settlements" && runtime.status === "ready" ? runtime.session.settlementActionCount : 0;
          return (
            <Link aria-current={item.isActive(pathname) ? "page" : undefined} aria-label={`Navigate to ${item.label}${count > 0 ? `, ${count} waiting for ${item.href === "/household" ? "review" : "you"}` : ""}`} className="journey-top-link" href={item.href} key={item.href} prefetch={false}>
              <span className="journey-glass-visual">{item.label}
              {count > 0 ? <span aria-hidden="true" className="journey-top-badge">{count}</span> : null}</span>
            </Link>
          );
        })}
      </nav>
      <div className="journey-header-actions">
      {runtime.status === "ready" ? <NotificationBell key={notificationContext} /> : null}
      {runtime.status === "ready" ? (
        <Link aria-describedby="header-profile-description" aria-label="Your profile" className="journey-profile" href="/profile" prefetch={false} title={`${runtime.session.displayName} · ${runtime.session.roleLabel}`}>
          <MemberAvatar avatarVersion={runtime.session.profileVersion} className="size-11 ring-1 ring-white [&_[data-slot=avatar-fallback]]:bg-brand [&_[data-slot=avatar-fallback]]:text-foreground" displayName={runtime.session.displayName} userId={runtime.capabilities.avatarContentReads ? runtime.session.userId : undefined} />
        </Link>
      ) : <div aria-hidden="true" className="size-11 rounded-full bg-secondary" />}
      {runtime.status === "ready" ? <span className="sr-only" id="header-profile-description">{runtime.session.displayName} · {runtime.session.roleLabel}</span> : null}
      </div>
    </header>
  );
}
