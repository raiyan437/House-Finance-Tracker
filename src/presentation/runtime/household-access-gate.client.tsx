"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ErrorState, LoadingState } from "@/presentation/components/async-state";
import { PageContainer } from "@/presentation/shell/page-container";
import { useApplicationRuntime } from "./application-runtime-context";

export const HOUSEHOLD_REQUIRED_ROUTE_PREFIXES = Object.freeze([
  "/dashboard",
  "/expenses",
  "/settlements",
  "/reports",
]);

export function routeRequiresHousehold(pathname: string): boolean {
  return HOUSEHOLD_REQUIRED_ROUTE_PREFIXES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function HouseholdAccessGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const runtime = useApplicationRuntime();
  const requiresHousehold = routeRequiresHousehold(pathname);
  const lacksHousehold = runtime.status === "ready" &&
    (runtime.household.status === "no-household" || runtime.household.status === "pending-request");

  useEffect(() => {
    if (requiresHousehold && lacksHousehold) router.replace("/household");
  }, [lacksHousehold, requiresHousehold, router]);

  if (!requiresHousehold) return children;

  if (runtime.status === "loading" || lacksHousehold) {
    return (
      <PageContainer>
        <LoadingState label={lacksHousehold ? "Opening household onboarding" : "Loading your household"} />
      </PageContainer>
    );
  }

  if (runtime.status === "error") {
    return (
      <PageContainer>
        <ErrorState
          description={runtime.message}
          onRetry={runtime.retry}
          title="Your household could not be loaded"
        />
      </PageContainer>
    );
  }

  return children;
}
