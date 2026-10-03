"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/presentation/runtime/production-transport";
import { ApplicationError } from "@/application/errors/application-error";

export function useAuthForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return {
    pending,
    error,
    async submit(
      body: unknown,
      endpoint: string,
      onDone?: (payload: Record<string, unknown>) => void,
      onFailed?: (payload: Record<string, unknown>) => void,
    ) {
      setPending(true);
      setError(undefined);
      try {
        const payload = await requestJson<Record<string, unknown>>(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        onDone?.(payload);
        router.refresh();
      } catch (error) {
        const message = error instanceof ApplicationError ? error.message : "The service is temporarily unavailable. Please try again.";
        setError(message);
        onFailed?.(error instanceof ApplicationError ? (error as ApplicationError & { body?: Record<string, unknown> }).body ?? { error: message } : { error: message });
      } finally {
        setPending(false);
      }
    },
  };
}
