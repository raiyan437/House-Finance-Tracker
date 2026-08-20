"use client";

import { useState } from "react";
import { Check, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export interface DevelopmentIdentityOption {
  readonly userId: UserId;
  readonly displayName: string;
}

interface DevelopmentToolsProps {
  readonly identities: readonly DevelopmentIdentityOption[];
  readonly currentUserId?: UserId;
  readonly onSwitchIdentity: (userId: UserId) => Promise<void>;
}

export function DevelopmentTools({
  identities,
  currentUserId,
  onSwitchIdentity,
}: DevelopmentToolsProps) {
  const [switchingTo, setSwitchingTo] = useState<UserId>();

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
          className="fixed right-4 bottom-[calc(var(--mobile-navigation-height)+env(safe-area-inset-bottom)+var(--space-4))] z-40 gap-1.5 border-border-strong bg-warning-soft text-foreground shadow-[var(--shadow-small)] hover:bg-warning-soft/80 lg:bottom-2 lg:left-[9.5rem] lg:right-auto"
          data-testid="development-tools-trigger"
          size="sm"
          variant="outline"
        >
          <Wrench aria-hidden="true" />
          <span className="font-semibold">DEV</span>
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
        <div className="grid gap-3 p-6" role="list" aria-label="Development identities">
          {identities.map((identity) => {
            const isCurrent = identity.userId === currentUserId;
            const isSwitching = identity.userId === switchingTo;

            return (
              <Button
                aria-current={isCurrent ? "true" : undefined}
                className="h-auto min-h-12 justify-between px-4 py-3 text-left"
                data-testid={`development-identity-${identity.userId}`}
                key={identity.userId}
                onClick={() => void switchIdentity(identity.userId)}
                role="listitem"
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
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
