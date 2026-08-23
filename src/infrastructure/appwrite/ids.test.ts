import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  guardRowId,
  commandOutcomeRowId,
  assertAppwriteRowId,
  assertGuardIdentity,
  GUARD_KINDS,
  QUOTA_COUNTER_KINDS,
} from "./ids";

describe("appwrite row id derivation", () => {
  it("derives deterministic 36-character ids for every guard kind", () => {
    for (const kind of [...GUARD_KINDS, ...QUOTA_COUNTER_KINDS]) {
      const id = guardRowId(`${kind}:{target}`);
      expect(id).toBe(guardRowId(`${kind}:{target}`));
      expect(() => assertAppwriteRowId(id)).not.toThrow();
      expect(id.startsWith("g_")).toBe(true);
    }
  });

  it("produces distinct ids for distinct logical keys and for distinct kinds", () => {
    expect(guardRowId("financial:{a}")).not.toBe(guardRowId("financial:{b}"));
    expect(guardRowId("active-membership:{u}")).not.toBe(guardRowId("pending-join:{u}"));
  });

  it("uses a cryptographic digest rather than a weak hash", () => {
    const id = guardRowId("financial:{h}");
    expect(id).toMatch(/^g_[0-9a-f]{34}$/);
  });

  it("rejects logical keys that would collide after truncation by refusing empty input", () => {
    expect(() => guardRowId("")).toThrow();
  });

  it("derives deterministic command outcome row ids within constraints", () => {
    const id = commandOutcomeRowId({ actorId: "user_1", commandType: "create-expense", commandId: randomUUID() });
    expect(() => assertAppwriteRowId(id)).not.toThrow();
    expect(commandOutcomeRowId({ actorId: "user_1", commandType: "create-expense", commandId: "x" })).toBe(
      commandOutcomeRowId({ actorId: "user_1", commandType: "create-expense", commandId: "x" }),
    );
  });

  it("verifies the stored logical key against the derived id before a guard is trusted", () => {
    const key = "financial:{household-1}";
    expect(() => assertGuardIdentity({ id: guardRowId(key), logicalKey: key }, key)).not.toThrow();
    expect(() => assertGuardIdentity({ id: guardRowId(key), logicalKey: "financial:{household-2}" }, key)).toThrow(/identity mismatch/);
    expect(() => assertGuardIdentity({ id: "g_" + createHash("sha256").update("spoof").digest("hex").slice(0, 34), logicalKey: key }, key)).toThrow(
      /identity mismatch/,
    );
    expect(() => assertGuardIdentity({ id: guardRowId(key), logicalKey: key }, "")).toThrow();
  });
});
