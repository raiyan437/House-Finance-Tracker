import { describe, expect, it } from "vitest";
import type { Account } from "node-appwrite";
import { ensureProfile, loginWithPassword, logoutCurrentSession, restoreSessionState, signupWithPassword, updateCurrentPassword } from "./account-service.server";
import type { AuthCoreDeps } from "./account-service.server";

const APPROVED_ACCOUNTS = { status: "enabled", emails: ["raiyan@test.io", "john@test.io"] } as const;

type ClientKind = "public" | "admin" | "session";

interface RecordedCall {
  readonly kind: ClientKind;
  readonly method: string;
  readonly args?: Record<string, unknown>;
}

function instrumentedHarness(options: Readonly<{ sessionSecret: string; failAdminForbiddenMethods?: boolean }>) {
  const calls: RecordedCall[] = [];
  const FORBIDDEN_ON_ADMIN = new Set(["get", "deleteSession"]);

  function makeClient(kind: ClientKind): Account {
    const record = (method: string) => (args?: Record<string, unknown>) => {
      calls.push({ kind, method, args });
      if (kind === "admin" && options.failAdminForbiddenMethods && FORBIDDEN_ON_ADMIN.has(method)) {
        throw Object.assign(new Error("WRONG-CLIENT"), { code: 401, type: "general_unauthorized_scope" });
      }
      switch (method) {
        case "create":
          return { $id: "user_new", email: String(args?.email) };
        case "createEmailPasswordSession":
          return { secret: options.sessionSecret, expire: "2027-01-01T00:00:00.000Z" };
        case "get":
          return { $id: "user_raiyan", email: "raiyan@test.io" };
        default:
          return {};
      }
    };
    return new Proxy({} as Account, {
      get(_target, property: string | symbol) {
        if (typeof property !== "string") return undefined;
        return (args?: Record<string, unknown>) => record(property)(args);
      },
    }) as Account;
  }

  const profileStore: Record<string, { displayName: string }> = {};
  const tablesDB = {
    getRow: async ({ rowId }: { rowId: string }) => {
      const profile = profileStore[rowId];
      if (!profile) throw Object.assign(new Error("not found"), { code: 404, type: "document_not_found" });
      return { ...profile, $id: rowId };
    },
    createRow: async ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) => {
      if (profileStore[rowId]) throw Object.assign(new Error("conflict"), { code: 409, type: "row_already_exists" });
      profileStore[rowId] = { displayName: String(data.displayName) };
    },
    incrementRowColumn: async () => ({ counter: 1 }),
  } as unknown as AuthCoreDeps["tablesDB"];

  const deps: AuthCoreDeps = {
    publicAccount: () => makeClient("public"),
    adminAccount: () => makeClient("admin"),
    sessionAccount: () => makeClient("session"),
    tablesDB,
    accountEmails: APPROVED_ACCOUNTS,
    authSecret: "test-secret",
    origin: "https://hft.test",
  };
  return { deps, calls, profileStore };
}

describe("auth client classification (admin vs session)", () => {
  it("uses only the keyless Account client for signup account and session creation", async () => {
    const harness = instrumentedHarness({ sessionSecret: "sec_signup" });
    await signupWithPassword(harness.deps, ["ip"], {
      email: "raiyan@test.io", password: "new-password", confirmPassword: "new-password",
    });
    expect(harness.calls.filter((call) => ["create", "createEmailPasswordSession"].includes(call.method))).toEqual([
      expect.objectContaining({ kind: "public", method: "create" }),
      expect.objectContaining({ kind: "public", method: "createEmailPasswordSession" }),
    ]);
  });

  it("performs account.get through the session client during login and restoration", async () => {
    const harness = instrumentedHarness({ sessionSecret: "sec_login" });
    await loginWithPassword(harness.deps, ["ip"], { email: "raiyan@test.io", password: "pw" });
    expect(harness.calls.filter((call) => call.method === "get").every((call) => call.kind === "session")).toBe(true);

    const restoreHarness = instrumentedHarness({ sessionSecret: "sec_restore" });
    await restoreSessionState(restoreHarness.deps, "sec_restore");
    expect(restoreHarness.calls.filter((call) => call.method === "get").every((call) => call.kind === "session")).toBe(true);
  });

  it("regression: logout deletes the current session through the session client, never the API-key admin client", async () => {
    const { deps, calls } = instrumentedHarness({ sessionSecret: "sec_logout" });
    const result = await logoutCurrentSession(deps, "sec_logout");
    expect(result.cookie).toEqual({ action: "clear" });
    const deleteCalls = calls.filter((call) => call.method === "deleteSession");
    expect(deleteCalls).toEqual([{ kind: "session", method: "deleteSession", args: { sessionId: "current" } }]);
  });

  it("updates passwords through the authenticated session client only", async () => {
    const harness = instrumentedHarness({ sessionSecret: "sec_password" });
    await updateCurrentPassword(harness.deps, "sec_password", {
      currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password",
    });
    expect(harness.calls.filter((call) => call.method === "updatePassword")).toEqual([
      { kind: "session", method: "updatePassword", args: { password: "new-password", oldPassword: "old-password" } },
    ]);
  });

  it("never invokes account verification or email mutation methods anywhere in 13B", async () => {
    const harness = instrumentedHarness({ sessionSecret: "sec" });
    await loginWithPassword(harness.deps, ["ip"], { email: "raiyan@test.io", password: "pw" });
    await restoreSessionState(harness.deps, "sec");
    await logoutCurrentSession(harness.deps, "sec");
    const forbiddenCalls = harness.calls.filter((call) => /verification|updateEmail/i.test(call.method));
    expect(forbiddenCalls).toEqual([]);
  });

  it("forbidden admin usage of user-session methods fails loudly in every happy-path flow", async () => {
    const flows = [
      async (deps: AuthCoreDeps) => loginWithPassword(deps, ["ip"], { email: "raiyan@test.io", password: "pw" }),
      async (deps: AuthCoreDeps) => logoutCurrentSession(deps, "sec"),
      async (deps: AuthCoreDeps) => restoreSessionState(deps, "sec"),
    ];
    for (const flow of flows) {
      const harness = instrumentedHarness({ sessionSecret: "sec", failAdminForbiddenMethods: true });
      await flow(harness.deps);
      const wrongClient = harness.calls.filter((call) => call.kind === "admin" && ["get", "deleteSession"].includes(call.method));
      expect(wrongClient).toEqual([]);
    }
  });

  it("ensureProfile repairs a missing profile deterministically from the Auth identity", async () => {
    const harness = instrumentedHarness({ sessionSecret: "sec" });
    const first = await ensureProfile(harness.deps.tablesDB, { id: "user_new", email: "new@test.io" }, "New Member");
    expect(first.displayName).toBe("New Member");
    const second = await ensureProfile(harness.deps.tablesDB, { id: "user_new", email: "new@test.io" });
    expect(second).toEqual(first);
  });
});
