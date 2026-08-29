"use client";

import type { ReactNode } from "react";
import { useApplicationRuntime } from "./application-runtime-context";
import type { ProductCapabilities } from "@/application/runtime-capabilities";

export const MUTATION_PENDING_NOTICE = "This action arrives with the next production update.";

/**
 * Honest capability gating (R1-9): controls bound to unavailable production
 * write families render disabled with a restrained explanation instead of
 * failing at runtime.
 */
export function useCapability<const K extends keyof ProductCapabilities>(capability: K): boolean {
  const runtime = useApplicationRuntime();
  if (runtime.status !== "ready") return true;
  return runtime.capabilities[capability];
}

export function CapabilityNotice({ active, children }: Readonly<{ active: boolean; children?: ReactNode }>) {
  if (!active) return null;
  return (
    <p className="text-xs leading-5 text-text-muted" data-capability-pending role="note">
      {children ?? MUTATION_PENDING_NOTICE}
    </p>
  );
}
