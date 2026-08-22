"use client";

import { useCallback, useRef } from "react";
import { commandId, type CommandId } from "@/domain/shared/identifiers";

export function useIdempotentCommand() {
  const active = useRef<Readonly<{ intent: string; commandId: CommandId }> | undefined>(undefined);
  const forIntent = useCallback((intent: string): CommandId => {
    if (active.current?.intent === intent) return active.current.commandId;
    const next = commandId(crypto.randomUUID());
    active.current = Object.freeze({ intent, commandId: next });
    return next;
  }, []);
  const complete = useCallback(() => { active.current = undefined; }, []);
  return { forIntent, complete };
}
