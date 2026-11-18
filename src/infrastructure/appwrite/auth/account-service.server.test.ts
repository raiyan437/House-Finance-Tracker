import { describe, expect, it } from "vitest";
import {
  AUTH_THROTTLE_RULES,
  completePasswordReset,
  initiatePasswordRecovery,
  loginWithPassword,
  logoutCurrentSession,
  restoreSessionState,
  signupWithPassword,
  updateCurrentPassword,
  verifyCurrentEmail,
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

const verifiedUser = { $id: "user_raiyan", email: "member@test.io", status: true, emailVerification: true };
const unverifiedUser = { $id: "user_new", email: "new@test.io", status: true, emailVerification: false };
const signupInput = { email: "new@test.io", password: "new-password", confirmPassword: "new-password" };

function makeDeps(overrides: Partial<AuthCoreDeps> = {}): AuthCoreDeps {
  const publicAccount = (() => ({
    create: async ({ email }: { email: string }) => ({ $id: "user_new", email }),
  })) as unknown as AuthCoreDeps["publicAccount"];
  const adminAccount = (() => ({
    createEmailPasswordSession: async ({ email }: { email: string }) => ({ secret: "sec_" + email, expire: "2027-01-01T00:00:00.000Z" }),
    createRecovery: async () => ({}),
    updateRecovery: async () => ({}),
  })) as unknown as AuthCoreDeps["adminAccount"];
  return {
    publicAccount,
    adminAccount,
    sessionAccount: (() => ({
      get: async () => verifiedUser,
      deleteSession: async () => ({}),
    })) as unknown as AuthCoreDeps["sessionAccount"],
    tablesDB: fakeTablesDB(),
    authSecret: "test-secret",
    origin: "https://hft.test",
    ...overrides,
  };
}

function signupSession(): AuthCoreDeps["sessionAccount"] {
  return (() => ({
    get: async () => unverifiedUser,
    createEmailVerification: async () => ({}),
  })) as unknown as AuthCoreDeps["sessionAccount"];
}

describe("authentication core", () => {
  it("registers an arbitrary email and sends verification without creating a Profile", async () => {
    const store: Record<string, { displayName: string }> = {};
    let receivedEmail = "";
    let verificationUrl = "";
    const deps = makeDeps({
      tablesDB: fakeTablesDB(store),
      publicAccount: (() => ({
        create: async ({ email }: { email: string }) => {
          receivedEmail = email;
          return unverifiedUser;
        },
      })) as unknown as AuthCoreDeps["publicAccount"],
      sessionAccount: (() => ({
        get: async () => unverifiedUser,
        createEmailVerification: async ({ url }: { url: string }) => { verificationUrl = url; },
      })) as unknown as AuthCoreDeps["sessionAccount"],
    });
    const result = await signupWithPassword(deps, ["ip"], { ...signupInput, email: "  NEW@test.io " });
    expect(receivedEmail).toBe("new@test.io");
    expect(verificationUrl).toBe("https://hft.test/verify-email");
    expect(store.user_new).toBeUndefined();
    expect(result).toMatchObject({
      status: 201, body: { status: "verification-required", verificationEmailSent: true }, cookie: { action: "set", secret: "sec_new@test.io" },
    });
  });

  it("leaves a recoverable verification session when the initial email fails", async () => {
    const deps = makeDeps({
      sessionAccount: (() => ({
        get: async () => unverifiedUser,
        createEmailVerification: async () => { throw new Error("temporary mail failure"); },
      })) as unknown as AuthCoreDeps["sessionAccount"],
    });
    await expect(signupWithPassword(deps, ["ip"], signupInput)).resolves.toMatchObject({
      status: 201, body: { status: "verification-required", verificationEmailSent: false }, cookie: { action: "set" },
    });
  });

  it("never issues an empty session cookie after account creation", async () => {
    const deps = makeDeps({
      adminAccount: (() => ({
        createEmailPasswordSession: async () => ({ secret: "", expire: "2027-01-01T00:00:00.000Z" }),
      })) as unknown as AuthCoreDeps["adminAccount"],
    });
    await expect(signupWithPassword(deps, ["ip"], signupInput)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE", message: "Your account was created, but sign-in could not be completed. Please sign in.",
    });
  });

  it.each([
    { providerCode: 429, providerType: "general_rate_limit_exceeded", expected: "RATE_LIMITED" },
    { providerCode: 501, providerType: "user_count_exceeded", expected: "PROVIDER_UNAVAILABLE" },
  ])("sanitizes a provider signup failure with $providerType", async ({ providerCode, providerType, expected }) => {
    const deps = makeDeps({
      publicAccount: (() => ({
        create: async () => { throw Object.assign(new Error("private provider detail"), { code: providerCode, type: providerType }); },
      })) as unknown as AuthCoreDeps["publicAccount"],
    });
    await expect(signupWithPassword(deps, ["ip"], signupInput)).rejects.toMatchObject({
      code: expected, message: expect.not.stringContaining("private provider detail"),
    });
  });

  it("validates signup passwords independently on the server", async () => {
    const deps = makeDeps();
    await expect(signupWithPassword(deps, ["ip"], {
      email: "raiyan@test.io", password: "short", confirmPassword: "short",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(signupWithPassword(deps, ["ip"], {
      email: "raiyan@test.io", password: "new-password", confirmPassword: "different-password",
    })).rejects.toMatchObject({ code: "INVALID_INPUT", message: "Passwords do not match." });
  });

  it("returns a non-destructive existing-account result", async () => {
    const deps = makeDeps({
      publicAccount: (() => ({
        create: async () => { throw Object.assign(new Error("exists"), { code: 409, type: "user_already_exists" }); },
      })) as unknown as AuthCoreDeps["publicAccount"],
    });
    const result = await signupWithPassword(deps, ["ip"], {
      email: "raiyan@test.io", password: "new-password", confirmPassword: "new-password",
    });
    expect(result).toEqual({
      status: 409,
      body: { code: "ACCOUNT_EXISTS", error: "An account already exists for this email. Sign in or reset your password." },
    });
  });

  it("allows only one winner during concurrent duplicate signup", async () => {
    let created = false;
    const deps = makeDeps({
      sessionAccount: signupSession(),
      publicAccount: (() => ({
        create: async ({ email }: { email: string }) => {
          if (created) throw Object.assign(new Error("exists"), { code: 409, type: "user_already_exists" });
          created = true;
          return { $id: "user_new", email };
        },
      })) as unknown as AuthCoreDeps["publicAccount"],
    });
    const input = signupInput;
    const results = await Promise.all([
      signupWithPassword(deps, ["ip-a"], input),
      signupWithPassword(deps, ["ip-b"], input),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it("repairs a verified account Profile on login after a transient restore failure", async () => {
    const profiles: Record<string, { displayName: string }> = {};
    let failProfileCreate = true;
    const base = fakeTablesDB(profiles);
    const tablesDB = {
      getRow: base.getRow.bind(base),
      incrementRowColumn: base.incrementRowColumn.bind(base),
      createRow: async (input: { tableId?: string; rowId: string; data: Record<string, unknown> }) => {
        if (input.tableId === "profiles" && failProfileCreate) {
          throw Object.assign(new Error("temporary tables failure"), { code: 503, type: "general_server_error" });
        }
        return base.createRow(input as never);
      },
    } as unknown as AuthCoreDeps["tablesDB"];
    const deps = makeDeps({ tablesDB });
    await expect(restoreSessionState(deps, "session")).resolves.toMatchObject({ status: 503 });
    expect(profiles.user_raiyan).toBeUndefined();
    failProfileCreate = false;
    await expect(loginWithPassword(deps, ["ip-login"], {
      email: "raiyan@test.io", password: "new-password",
    })).resolves.toMatchObject({ status: 200, body: { status: "authenticated" } });
    expect(profiles.user_raiyan?.displayName).toBe("Member");
  });

  it("bounds signup to five attempts per day using an opaque IP identity", async () => {
    const writes: unknown[] = [];
    const tablesDB = fakeTablesDB();
    const originalCreate = tablesDB.createRow.bind(tablesDB);
    tablesDB.createRow = (async (input: unknown) => { writes.push(input); return originalCreate(input as never); }) as typeof tablesDB.createRow;
    const deps = makeDeps({ tablesDB, sessionAccount: signupSession() });
    for (let attempt = 0; attempt < AUTH_THROTTLE_RULES.signup.limit; attempt += 1) {
      await expect(signupWithPassword(deps, ["private-signup-ip"], {
        email: "raiyan@test.io", password: "new-password", confirmPassword: "new-password",
      })).resolves.toMatchObject({ status: 201 });
    }
    await expect(signupWithPassword(deps, ["private-signup-ip"], {
      email: "raiyan@test.io", password: "new-password", confirmPassword: "new-password",
    })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(JSON.stringify(writes)).not.toContain("private-signup-ip");
    expect(AUTH_THROTTLE_RULES.signup).toEqual({ scope: "auth-signup", limit: 5, windowSeconds: 86_400 });
  });

  it("logs in a verified user and repairs a missing profile", async () => {
    const store: Record<string, { displayName: string }> = {};
    const deps = makeDeps({ tablesDB: fakeTablesDB(store) });
    const result = await loginWithPassword(deps, ["ip"], { email: "raiyan@test.io", password: "pw" });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("authenticated");
    expect(store.user_raiyan?.displayName).toBe("Member");
  });

  it("returns generic credentials for an unknown provider account", async () => {
    let providerCalls = 0;
    const deps = makeDeps({
      adminAccount: (() => ({
        createEmailPasswordSession: async () => {
          providerCalls += 1;
          throw Object.assign(new Error("not found"), { code: 404, type: "user_not_found" });
        },
      })) as unknown as AuthCoreDeps["adminAccount"],
    });
    const result = await loginWithPassword(deps, ["ip"], { email: "unknown@test.io", password: "pw" });
    expect(result).toEqual({ status: 401, body: { error: "Invalid credentials." } });
    expect(providerCalls).toBe(1);
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

  it("keeps an unverified provider account out of the product without clearing its verification session", async () => {
    const profiles: Record<string, { displayName: string }> = {};
    const deps = makeDeps({ tablesDB: fakeTablesDB(profiles), sessionAccount: signupSession() });
    const result = await loginWithPassword(deps, ["ip"], signupInput);
    expect(result).toMatchObject({ status: 200, body: { status: "verification-required" }, cookie: { action: "set" } });
    await expect(restoreSessionState(deps, "pending")).resolves.toEqual({
      status: 200, body: { status: "verification-required" },
    });
    await expect(updateCurrentPassword(deps, "pending", {
      currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password",
    })).resolves.toMatchObject({ status: 403 });
    expect(profiles.user_new).toBeUndefined();
  });

  it("rejects disabled accounts even when their email is verified", async () => {
    const deps = makeDeps({
      sessionAccount: (() => ({
        get: async () => ({ ...verifiedUser, status: false }),
      })) as unknown as AuthCoreDeps["sessionAccount"],
    });
    await expect(loginWithPassword(deps, ["ip"], signupInput)).resolves.toMatchObject({ status: 401 });
    await expect(restoreSessionState(deps, "disabled")).resolves.toMatchObject({
      status: 200, body: { status: "anonymous" }, cookie: { action: "clear" },
    });
  });

  it("binds confirmation to the session account and creates a Profile only once verified", async () => {
    const profiles: Record<string, { displayName: string }> = {};
    let verified = false;
    let confirmations = 0;
    const deps = makeDeps({
      tablesDB: fakeTablesDB(profiles),
      sessionAccount: (() => ({
        get: async () => ({ ...unverifiedUser, emailVerification: verified }),
        updateEmailVerification: async ({ userId, secret }: { userId: string; secret: string }) => {
          confirmations += 1;
          expect(userId).toBe(unverifiedUser.$id);
          if (secret !== "valid-secret") throw Object.assign(new Error("provider token error"), { code: 401, type: "user_invalid_token" });
          verified = true;
        },
      })) as unknown as AuthCoreDeps["sessionAccount"],
    });
    const intent = { action: "confirm", userId: unverifiedUser.$id, secret: "valid-secret" } as const;
    await expect(verifyCurrentEmail(deps, undefined, intent)).resolves.toMatchObject({ status: 401 });
    await expect(verifyCurrentEmail(deps, "session", { ...intent, userId: "other_account" })).resolves.toMatchObject({ status: 400 });
    expect(confirmations).toBe(0);
    await expect(verifyCurrentEmail(deps, "session", { ...intent, secret: "expired" })).resolves.toMatchObject({ status: 400 });
    expect(profiles.user_new).toBeUndefined();
    await expect(verifyCurrentEmail(deps, "session", intent)).resolves.toEqual({ status: 200, body: { verified: true } });
    await expect(restoreSessionState(deps, "session")).resolves.toMatchObject({
      status: 200, body: { status: "authenticated", displayName: "Member" },
    });
    await expect(verifyCurrentEmail(deps, "session", intent)).resolves.toMatchObject({ status: 200 });
    expect(confirmations).toBe(2);
  });

  it("bounds verification email sends by account across sessions", async () => {
    const deps = makeDeps({ sessionAccount: signupSession() });
    for (let attempt = 0; attempt < AUTH_THROTTLE_RULES.verificationEmail.limit; attempt += 1) {
      await expect(verifyCurrentEmail(deps, "session-" + attempt, { action: "send" })).resolves.toMatchObject({ status: 200 });
    }
    await expect(verifyCurrentEmail(deps, "another-session", { action: "send" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("updates a password through the authenticated session client and clears the local session", async () => {
    let updateInput: unknown;
    const deps = makeDeps({
      sessionAccount: (() => ({
        get: async () => verifiedUser,
        updatePassword: async (input: unknown) => { updateInput = input; },
      })) as unknown as AuthCoreDeps["sessionAccount"],
    });
    const result = await updateCurrentPassword(deps, "session-secret", {
      currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password",
    });
    expect(updateInput).toEqual({ password: "new-password", oldPassword: "old-password" });
    expect(result).toEqual({ status: 200, body: { updated: true }, cookie: { action: "clear" } });
    expect(JSON.stringify(result)).not.toMatch(/old-password|new-password/);
  });

  it("returns safe password-update errors without mutating on invalid or wrong credentials", async () => {
    let updateCalls = 0;
    const deps = makeDeps({
      sessionAccount: (() => ({
        get: async () => verifiedUser,
        updatePassword: async () => { updateCalls += 1; throw Object.assign(new Error("provider detail"), { code: 401, type: "user_invalid_credentials" }); },
      })) as unknown as AuthCoreDeps["sessionAccount"],
    });
    await expect(updateCurrentPassword(deps, undefined, {
      currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password",
    })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(updateCurrentPassword(deps, "session", {
      currentPassword: "same-password", newPassword: "same-password", confirmPassword: "same-password",
    })).rejects.toMatchObject({ message: "New password must be different from current password." });
    await expect(updateCurrentPassword(deps, "session", {
      currentPassword: "old-password", newPassword: "new-password", confirmPassword: "different-password",
    })).rejects.toMatchObject({ message: "Passwords do not match." });
    const wrong = await updateCurrentPassword(deps, "session", {
      currentPassword: "wrong-password", newPassword: "new-password", confirmPassword: "new-password",
    });
    expect(wrong).toEqual({ status: 400, body: { error: "Current password is incorrect." } });
    expect(updateCalls).toBe(1);
  });

  it("accepts the new password and rejects the old password after a provider-stub update", async () => {
    let providerPassword = "old-password";
    const deps = makeDeps({
      adminAccount: (() => ({
        createEmailPasswordSession: async ({ email, password }: { email: string; password: string }) => {
          if (password !== providerPassword) throw Object.assign(new Error("invalid"), { code: 401, type: "user_invalid_credentials" });
          return { secret: `sec_${email}`, expire: "2027-01-01T00:00:00.000Z" };
        },
      })) as unknown as AuthCoreDeps["adminAccount"],
      sessionAccount: (() => ({
        get: async () => verifiedUser,
        updatePassword: async ({ password, oldPassword }: { password: string; oldPassword?: string }) => {
          if (oldPassword !== providerPassword) throw Object.assign(new Error("invalid"), { code: 401, type: "user_invalid_credentials" });
          providerPassword = password;
        },
      })) as unknown as AuthCoreDeps["sessionAccount"],
    });
    await updateCurrentPassword(deps, "session", {
      currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password",
    });
    await expect(loginWithPassword(deps, ["ip-old"], {
      email: "raiyan@test.io", password: "old-password",
    })).resolves.toEqual({ status: 401, body: { error: "Invalid credentials." } });
    await expect(loginWithPassword(deps, ["ip-new"], {
      email: "raiyan@test.io", password: "new-password",
    })).resolves.toMatchObject({ status: 200 });
  });

  it("returns the same recovery result for known and unknown accounts", async () => {
    let recoveryCalls = 0;
    let recoveryUrl = "";
    const deps = makeDeps({
      adminAccount: (() => ({
        createRecovery: async ({ email, url }: { email: string; url: string }) => {
          recoveryCalls += 1;
          recoveryUrl = url;
          if (email === "unknown@test.io") throw Object.assign(new Error("not found"), { code: 404, type: "user_not_found" });
        },
      })) as unknown as AuthCoreDeps["adminAccount"],
    });
    const approved = await initiatePasswordRecovery(deps, ["ip"], "raiyan@test.io");
    const unknown = await initiatePasswordRecovery(deps, ["ip"], "unknown@test.io");
    expect(approved).toEqual({ status: 200, body: { sent: true } });
    expect(unknown).toEqual(approved);
    expect(recoveryCalls).toBe(2);
    expect(recoveryUrl).toBe("https://hft.test/reset-password");
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
