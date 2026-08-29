import "server-only";
import { ApplicationError } from "@/application/errors/application-error";

const PROVIDER_NOT_FOUND_CODES = new Set([404]);

function statusCode(error: unknown): number | undefined {
  const candidate = error as { code?: unknown } | null;
  if (!candidate || typeof candidate !== "object") return undefined;
  return typeof candidate.code === "number" ? candidate.code : undefined;
}

export function isProviderNotFound(error: unknown): boolean {
  const status = statusCode(error);
  return status !== undefined && PROVIDER_NOT_FOUND_CODES.has(status);
}

/**
 * Provider failures are never forwarded raw: missing rows become a plain
 * `undefined` at the repository seam, and every other failure collapses into
 * the sanitized provider-unavailable application error.
 */
export function normalizedProviderFailure(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  return new ApplicationError("PERSISTENCE_FAILURE", "The production data plane is temporarily unavailable.");
}
