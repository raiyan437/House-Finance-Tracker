import { ApplicationError } from "@/application/errors/application-error";
import { DomainError } from "@/domain/shared/domain-error";

/**
 * Curated application/domain errors carry user-safe messages; anything else
 * (unexpected programming failures) is collapsed to a generic fallback so raw
 * technical text can never reach the UI.
 */
export function userErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApplicationError || error instanceof DomainError) {
    return error.message;
  }
  return fallback;
}
