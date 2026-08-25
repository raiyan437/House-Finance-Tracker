import { describe, expect, it } from "vitest";
import {
  AUTH_THROTTLE_RULES,
  completePasswordReset,
  initiatePasswordRecovery,
  loginWithPassword,
  logoutCurrentSession,
  restoreSessionState,
} from "./account-service.server";
import type { AuthCoreDeps } from "./account-service.server";

function fakeTablesDB(existingProfiles: Record<string, { displayName: string; counter?: number }> = {}) {
  return {
    getRow: async ({ rowId }: { rowId: string }) => {
      const profile = existingProfiles[rowId];
      if (!profile) throw Object.assign(new Error("not found"), { code: 404, type: "document_not_found" });
      return { ...profile, $id: rowId };
    },
    createRow: async ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) => {
      if (existingProfiles[rowId]) throw Object.assign(new Error("conflict"), { code: 409, type: "row_already_exists" });
      existingProfiles[rowId] = { displayName: String(data.displayName ?? ""), counter: Number(data.counter ?? 0) };
    },
    incrementRowColumn: async ({ rowId }: { rowId: string }) => {
      const bucketRow = (existingProfiles[rowId] ??= { displayName: "" });
      bucketRow.counter = (bucketRow.counter ?? 0) + 1;
      return { counter: bucketRow.counter };
    },
  } as unknown as AuthCoreDeps["tablesDB"];
}

function makeDeps(overrides: Partial<AuthCoreDeps> = {}): AuthCoreDeps {
  const adminAccount = (() => ({
    createEmailPasswordSession: async ({ email }: { email: string }) => ({ secret: "sec_" + email, expire: "2027-01-01T00:00:00.000Z" }),
    createRecovery: async () => ({}),
    updateRecovery: async () => ({}),
  })) as unknown as AuthCoreDeps["adminAccount"];
  return {
    adminAccount,
    sessionAccount: (() => ({
      get: async () => ({ $id: "user_raiyan", email: "raiyan@test.io" }),
      deleteSession: async () => ({}),
    })) as unknown as AuthCoreDeps["sessionAccount"],
    tablesDB: fakeTablesDB(),
    accountEmails: { status: "enabled", emails: ["raiyan@test.io"] },
    authSecret: "test-secret",
    origin: "https://hft.test",
    ...overrides,
  };
}

describe("authentication core for pre-provisioned accounts", () => {
  it("logs in an approved user and repairs a missing profile", async () => {
    const store: Record<string, { displayName: string }> = {};
    const deps = makeDeps({ tablesDB: fakeTablesDB(store) });
    const result = await loginWithPassword(deps, ["ip"], { email: "raiyan@test.io", password: "pw" });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("authenticated");
    expect(store.user_raiyan?.displayName).toBe("Raiyan");
  });

  it("rejects a non-approved login before the provider call with generic credentials", async () => {
    let providerCalls = 0;
    const deps = makeDeps({
      adminAccount: (() => ({
        createEmailPasswordSession: async () => {
          providerCalls += 1;
          return { secret: "unexpected", expire: "2027-01-01T00:00:00.000Z" };
        },
      })) as unknown as AuthCoreDeps["adminAccount"],
    });
    const result = await loginWithPassword(deps, ["ip"], { email: "unknown@test.io", password: "pw" });
    expect(result).toEqual({ status: 401, body: { error: "Invalid credentials." } });
    expect(providerCalls).toBe(0);
  });

  it("restores an authenticated session through the session client only", async () => {
    const deps = makeDeps();
    const result = await restoreSessionState(deps, "any-secret");
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("authenticated");
    expect(result.cookie).toBeUndefined();
  });

  it("clears local access on logout even when the provider is unreachable", async () => {
    const deps = makeDeps({
      sessionAccount: (() => {
        throw new Error("network down");
      }) as unknown as AuthCoreDeps["sessionAccount"],
    });
    const result = await logoutCurrentSession(deps, "secret");
    expect(result.cookie).toEqual({ action: "clear" });
    expect(String(result.body.warning)).toContain("could not be confirmed");
  });

  it("treats a provider-revoked session as anonymous and clears its cookie", async () => {
    const deps = makeDeps({
      sessionAccount: (() => ({
        get: async () => {
          throw Object.assign(new Error("revoked"), { code: 401, type: "user_unauthorized" });
        },
      })) as unknown as AuthCoreDeps["sessionAccount"],
    });
    const result = await restoreSessionState(deps, "revoked-secret");
    expect(result).toEqual({ status: 200, body: { status: "anonymous" }, cookie: { action: "clear" } });
  });

  it("returns the same recovery result for approved and unknown accounts without calling the provider for unknown accounts", async () => {
    let recoveryCalls = 0;
    const deps = makeDeps({
      adminAccount: (() => ({
        createRecovery: async () => {
          recoveryCalls += 1;
        },
      })) as unknown as AuthCoreDeps["adminAccount"],
    });
    const approved = await initiatePasswordRecovery(deps, ["ip"], "raiyan@test.io");
    const unknown = await initiatePasswordRecovery(deps, ["ip"], "unknown@test.io");
    expect(approved).toEqual({ status: 200, body: { sent: true } });
    expect(unknown).toEqual(approved);
    expect(recoveryCalls).toBe(1);
  });

  it("limits reset completion to five attempts per fifteen-minute HMAC bucket", async () => {
    const deps = makeDeps();
    const input = { userId: "user_reset", secret: "recovery-secret", password: "new-password" };
    for (let attempt = 0; attempt < AUTH_THROTTLE_RULES.reset.limit; attempt += 1) {
      await expect(completePasswordReset(deps, ["private-ip"], input)).resolves.toMatchObject({ status: 200 });
    }
    await expect(completePasswordReset(deps, ["private-ip"], input)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(AUTH_THROTTLE_RULES.reset).toEqual({ scope: "auth-reset", limit: 5, windowSeconds: 900 });
  });

  it("persists only an opaque HMAC identity for reset throttling", async () => {
    const writes: unknown[] = [];
    const tablesDB = {
      createRow: async (input: unknown) => {
        writes.push(input);
      },
    } as unknown as AuthCoreDeps["tablesDB"];
    const deps = makeDeps({ tablesDB });
    await completePasswordReset(deps, ["private-ip"], {
      userId: "private-user-id",
      secret: "recovery-secret",
      password: "new-password",
    });
    const persisted = JSON.stringify(writes);
    expect(persisted).not.toContain("private-ip");
    expect(persisted).not.toContain("private-user-id");
    expect(persisted).toContain("auth-reset");
  });
});
