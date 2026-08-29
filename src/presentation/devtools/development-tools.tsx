"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Check, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/presentation/components/status-badge";
import type { UserId } from "@/domain/shared/identifiers";
import { DevelopmentToolsSlotsProvider } from "./development-tools-slots";

export interface DevelopmentIdentityOption {
  readonly userId: UserId;
  readonly displayName: string;
}

export function useDevelopmentToolsActive(): boolean {
  return useContext(DevelopmentToolsContext) !== undefined;
}

interface DevelopmentToolsContextValue {
  readonly identities: readonly DevelopmentIdentityOption[];
  readonly currentUserId?: UserId;
  readonly onSwitchIdentity: (userId: UserId) => Promise<void>;
}

const DevelopmentToolsContext = createContext<DevelopmentToolsContextValue | undefined>(undefined);

export function DevelopmentToolsProvider({
  children,
  value,
}: Readonly<{
  children: React.ReactNode;
  value?: DevelopmentToolsContextValue;
}>) {
  const active = value !== undefined;
  const slots = useMemo(
    () => active ? {
        desktop: (compact: boolean) => <DevelopmentTools compact={compact} />,
        mobile: <MobileDevelopmentTools />,
      } : undefined,
    [active],
  );

  return (
    <DevelopmentToolsContext.Provider value={value}>
      <DevelopmentToolsSlotsProvider value={slots}>
        {children}
      </DevelopmentToolsSlotsProvider>
    </DevelopmentToolsContext.Provider>
  );
}

export function DevelopmentTools({ compact = false }: { readonly compact?: boolean }) {
  const context = useContext(DevelopmentToolsContext);
  const [switchingTo, setSwitchingTo] = useState<UserId>();

  if (!context) return null;
  const { identities, currentUserId, onSwitchIdentity } = context;

  async function switchIdentity(userId: UserId) {
    if (userId === currentUserId || switchingTo) return;
    setSwitchingTo(userId);
    try {
      await onSwitchIdentity(userId);
    } finally {
      setSwitchingTo(undefined);
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          aria-label="Open development tools"
          className={cn(
            "min-h-11 w-full justify-center gap-2 border-warning/30 bg-warning-soft text-foreground shadow-none transition-[gap] hover:bg-warning-soft/80",
            compact && "gap-0 px-0",
          )}
          data-testid="development-tools-trigger"
          title={compact ? "Open development tools" : undefined}
          variant="outline"
        >
          <Wrench aria-hidden="true" />
          <span
            aria-hidden={compact}
            className={cn(
              "overflow-hidden font-semibold transition-[max-width,opacity] duration-300 ease-[var(--motion-ease-out)]",
              compact ? "max-w-0 opacity-0" : "max-w-10 opacity-100",
            )}
          >
            DEV
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent aria-describedby="development-tools-description" side="right">
        <SheetHeader className="border-b p-6">
          <div className="mb-2">
            <StatusBadge tone="warning">Development only</StatusBadge>
          </div>
          <SheetTitle>Development tools</SheetTitle>
          <SheetDescription id="development-tools-description">
            Test the current-session boundary with deterministic local identities.
            This is not login or account switching.
          </SheetDescription>
        </SheetHeader>
        <ul className="grid gap-3 p-6" aria-label="Development identities">
          {identities.map((identity) => {
            const isCurrent = identity.userId === currentUserId;
            const isSwitching = identity.userId === switchingTo;

            return (
              <li key={identity.userId}>
                <Button
                  aria-current={isCurrent ? "true" : undefined}
                  className="h-auto min-h-12 w-full justify-between px-4 py-3 text-left"
                  data-testid={`development-identity-${identity.userId}`}
                  onClick={() => void switchIdentity(identity.userId)}
                  variant={isCurrent ? "secondary" : "outline"}
                >
                  <span>
                    <span className="block text-sm font-medium">{identity.displayName}</span>
                    <span className="block font-mono text-caption font-normal text-text-muted">
                      {identity.userId}
                    </span>
                  </span>
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 text-caption text-success">
                      <Check aria-hidden="true" className="size-4" />
                      Current
                    </span>
                  ) : isSwitching ? (
                    <span className="text-caption text-text-muted">Switching…</span>
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

export function MobileDevelopmentTools() {
  const context = useContext(DevelopmentToolsContext);
  const [switchingTo, setSwitchingTo] = useState<UserId>();

  if (!context) return null;
  const tools = context;

  async function switchIdentity(userId: UserId) {
    if (userId === tools.currentUserId || switchingTo) return;
    setSwitchingTo(userId);
    try {
      await tools.onSwitchIdentity(userId);
    } finally {
      setSwitchingTo(undefined);
    }
  }

  return (
    <section aria-labelledby="mobile-development-tools-title" className="border-t border-warning/30 bg-warning-soft/55 p-4 pb-8">
      <div className="mb-3 flex items-center gap-2">
        <Wrench aria-hidden="true" className="size-4" />
        <h2 className="text-xs font-semibold uppercase tracking-wide" id="mobile-development-tools-title">DEV · Development tools</h2>
      </div>
      <p className="mb-3 text-caption text-text-secondary">Local identity switching only. This is not login or Profile behavior.</p>
      <ul aria-label="Development identities" className="grid gap-2">
        {tools.identities.map((identity) => {
          const isCurrent = identity.userId === tools.currentUserId;
          return (
            <li key={identity.userId}>
              <Button
                aria-current={isCurrent ? "true" : undefined}
                className="min-h-12 w-full justify-between px-4"
                data-testid={`mobile-development-identity-${identity.userId}`}
                disabled={Boolean(switchingTo)}
                onClick={() => void switchIdentity(identity.userId)}
                variant={isCurrent ? "secondary" : "outline"}
              >
                <span>{identity.displayName}</span>
                <span className="text-caption text-text-muted">{isCurrent ? "Current" : switchingTo === identity.userId ? "Switching…" : "Switch"}</span>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
