import "server-only";
import { z } from "zod";

/** Frozen product rule: trim Household names and reject only empty text. */
export const householdNameInput = z.string().trim().min(1);

export const commandIdentifierInput = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, "A valid identifier is required.");
