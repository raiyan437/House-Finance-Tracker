import { describe, expect, it } from "vitest";
import { createHouseholdSchema } from "@/application/validation/household-onboarding.schema";
import { householdNameInput } from "./household-command-input.server";

describe("production Household name input", () => {
  it.each(["", "   ", "\t\r\n"])("rejects empty-after-trim input %j", (value) => {
    expect(householdNameInput.safeParse(value).success).toBe(false);
  });

  it.each([
    "Our House",
    "x".repeat(64),
    "x".repeat(65),
    "A".repeat(4_096),
  ])("accepts non-empty text without a product maximum", (value) => {
    expect(householdNameInput.parse(`  ${value}  `)).toBe(value);
  });

  it.each(["", "   ", "Normal House", "x".repeat(64), "x".repeat(65), "x".repeat(4_096)])(
    "matches the local Create validation result for %j",
    (value) => {
      const production = householdNameInput.safeParse(value);
      const local = createHouseholdSchema.safeParse({ name: value, code: "000000001" });
      expect(production.success).toBe(local.success);
      if (production.success && local.success) expect(production.data).toBe(local.data.name);
    },
  );
});
