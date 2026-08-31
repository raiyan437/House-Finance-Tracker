import { describe, expect, it } from "vitest";
import { profileDisplayNameCommandSchema } from "./route";

describe("Profile Display Name command contract", () => {
  it("accepts only trimmed-non-empty intent, Profile OCC, and command identity", () => {
    expect(profileDisplayNameCommandSchema.parse({
      displayName: "  Raiyan Updated  ",
      expectedVersion: 3,
      commandId: "profile-command-1",
    })).toEqual({ displayName: "Raiyan Updated", expectedVersion: 3, commandId: "profile-command-1" });
    expect(profileDisplayNameCommandSchema.safeParse({ displayName: "   ", expectedVersion: 3, commandId: "profile-command-1" }).success).toBe(false);
    expect(profileDisplayNameCommandSchema.parse({
      displayName: "N".repeat(20),
      expectedVersion: 3,
      commandId: "profile-command-long",
    }).displayName).toHaveLength(20);
    expect(profileDisplayNameCommandSchema.safeParse({
      displayName: "N".repeat(21),
      expectedVersion: 3,
      commandId: "profile-command-too-long",
    }).success).toBe(false);
  });

  it("rejects forged identity, email, role, Household, and timestamp fields structurally", () => {
    const base = { displayName: "Raiyan", expectedVersion: 3, commandId: "profile-command-1" };
    for (const forged of [
      { userId: "another-user" },
      { email: "other@example.test" },
      { role: "leader" },
      { householdId: "another-house" },
      { updatedAt: "2026-08-30T00:00:00.000Z" },
    ]) {
      expect(profileDisplayNameCommandSchema.safeParse({ ...base, ...forged }).success).toBe(false);
    }
  });
});
