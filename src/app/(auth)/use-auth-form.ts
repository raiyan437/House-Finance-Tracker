"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function useAuthForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return {
    pending,
    error,
    async submit(body: unknown, endpoint: string, onDone?: (payload: Record<string, unknown>) => void) {
      setPending(true);
      setError(undefined);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          setError(typeof payload.error === "string" ? payload.error : "Something went wrong. Please try again.");
          return;
        }
        onDone?.(payload);
        router.refresh();
      } catch {
        setError("The service is temporarily unavailable. Please try again.");
      } finally {
        setPending(false);
      }
    },
  };
}
