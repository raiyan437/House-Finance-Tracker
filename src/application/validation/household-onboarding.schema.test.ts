import { describe, expect, it } from "vitest";
import { createHouseholdSchema, householdCodeSchema } from "./household-onboarding.schema";

describe("household onboarding boundary validation", () => {
  it("preserves exact leading-zero codes and rejects non-ASCII or incorrectly sized input", () => {
    expect(householdCodeSchema.parse("012345678")).toBe("012345678");
    for (const code of ["12345678", "1234567890", "12345x789", "১২৩৪৫৬৭৮৯"]) {
      expect(householdCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it("trims a non-empty house name without inventing a maximum", () => {
    expect(createHouseholdSchema.parse({ name: "  A very long household name  ", code: "000000001" })).toEqual({
      name: "A very long household name",
      code: "000000001",
    });
    expect(createHouseholdSchema.safeParse({ name: "   ", code: "000000001" }).success).toBe(false);
  });
});
