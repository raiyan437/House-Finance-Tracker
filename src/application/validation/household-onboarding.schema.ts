import { z } from "zod";

export const householdCodeSchema = z
  .string()
  .regex(/^[0-9]{9}$/, "Enter exactly 9 digits.");

export const createHouseholdSchema = z.object({
  name: z.string().transform((value) => value.trim()).pipe(z.string().min(1, "Enter a house name.")),
  code: householdCodeSchema,
});

export const joinHouseholdSchema = z.object({
  code: householdCodeSchema,
});

export type CreateHouseholdInput = z.input<typeof createHouseholdSchema>;
export type CreateHouseholdValues = z.output<typeof createHouseholdSchema>;
export type JoinHouseholdInput = z.input<typeof joinHouseholdSchema>;
export type JoinHouseholdValues = z.output<typeof joinHouseholdSchema>;
