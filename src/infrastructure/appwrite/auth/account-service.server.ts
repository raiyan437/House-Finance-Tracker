import { AppwriteException, ID, type Account } from "node-appwrite";
import { AuthError } from "./auth-errors.server";
import type { AuthCookieDirective, SessionCookieDirective } from "./session-cookie";
import { deriveAuthThrottleIdentity, enforceAuthThrottle } from "./throttle.server";

export interface AuthCoreDeps {
  /** Keyless Account API client used only for ordinary end-user account creation. */
  readonly publicAccount: () => Account;
  readonly adminAccount: () => Account;
  readonly sessionAccount: (sessionSecret: string) => Account;
  readonly tablesDB: import("node-appwrite").TablesDB;
  readonly authSecret: string;
  readonly origin: string;
}

export interface AuthOperationResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly cookie?: AuthCookieDirective;
}

function providerErrorMatches(
  error: unknown,
  match: Readonly<{ code?: number; type?: string; types?: readonly string[] }>,
): boolean {
  const candidate = error as { code?: number; type?: string } | null;
  if (!candidate || typeof candidate !== "object") return false;
  const isProviderShaped = error instanceof AppwriteException || (typeof candidate.code === "number" && typeof candidate.type === "string");
  if (!isProviderShaped) return false;
  if (match.code !== undefined && candidate.code !== match.code) return false;
  const wantedTypes = [match.type, ...(match.types ?? [])].filter((value): value is string => Boolean(value));
  return wantedTypes.length === 0 || wantedTypes.includes(candidate.type ?? "");
}
const GENERIC_CREDENTIALS_ERROR = "Invalid credentials.";
const SERVICE_UNAVAILABLE = "The authentication service is temporarily unavailable.";
const VERIFICATION_REQUIRED = { status: "verification-required" } as const;
const INVALID_VERIFICATION_LINK = { status: 400, body: { error: "This verification link is invalid or has expired. Request a new link." } };

export const AUTH_THROTTLE_RULES = {
  login: { scope: "auth-login", limit: 10, windowSeconds: 900 },
  signup: { scope: "auth-signup", limit: 5, windowSeconds: 86_400 },
  verificationEmail: { scope: "auth-verification-email", limit: 3, windowSeconds: 3600 },
  verificationConfirm: { scope: "auth-verification-confirm", limit: 5, windowSeconds: 900 },
  recovery: { scope: "auth-recovery", limit: 3, windowSeconds: 3600 },
  reset: { scope: "auth-reset", limit: 5, windowSeconds: 900 },
  /** Approved with the Phase 13 rate-limit table; shared by lookup and generation reads. */
  houseCodeLookup: { scope: "house-code", limit: 10, windowSeconds: 3600 },
} as const;

function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("INVALID_INPUT", "A valid email is required.");
  return email;
}

export function classifyAccount(user: Pick<Awaited<ReturnType<Account["get"]>>, "status" | "emailVerification">) {
  if (user.status !== true) return "anonymous";
  return user.emailVerification === true ? "authenticated" : "verification-required";
}

export function isInvalidSession(error: unknown): boolean {
  return (error instanceof AuthError && error.code === "SESSION_INVALID") ||
    providerErrorMatches(error, { code: 401 }) ||
    providerErrorMatches(error, { types: ["user_blocked", "user_not_found"] });
}

function isRateLimited(error: unknown): boolean {
  return (error instanceof AuthError && error.code === "RATE_LIMITED") || providerErrorMatches(error, { code: 429 });
}

function rateLimitError() {
  return new AuthError("RATE_LIMITED", "Too many attempts. Please try again later.");
}

async function createPasswordSession(deps: AuthCoreDeps, email: string, password: string): Promise<SessionCookieDirective> {
  const { secret, expire } = await deps.adminAccount().createEmailPasswordSession({ email, password });
  if (!secret || !Number.isFinite(Date.parse(expire))) throw new AuthError("PROVIDER_UNAVAILABLE", SERVICE_UNAVAILABLE);
  return { action: "set", secret, expire };
}

function validateNewPassword(password: string): void {
  if (password.length < 8 || password.length > 256) {
    throw new AuthError("INVALID_INPUT", "Password must be between 8 and 256 characters.");
  }
}

function validatePasswordConfirmation(password: string, confirmation: string): void {
  if (password !== confirmation) throw new AuthError("INVALID_INPUT", "Passwords do not match.");
}

const EXISTING_ACCOUNT_MESSAGE = "An account already exists for this email. Sign in or reset your password.";

export async function signupWithPassword(
  deps: AuthCoreDeps,
  identityParts: readonly string[],
  input: Readonly<{ email: string; password: string; confirmPassword: string }>,
): Promise<AuthOperationResult> {
  const email = normalizeEmail(input.email);
  validateNewPassword(input.password);
  validatePasswordConfirmation(input.password, input.confirmPassword);
  await enforceAuthThrottle(deps.tablesDB, {
    secret: deps.authSecret,
    rule: AUTH_THROTTLE_RULES.signup,
    identityParts,
  });

  let userId: string;
  try {
    const createdUser = await deps.publicAccount().create({
      userId: ID.unique(),
      email,
      password: input.password,
    });
    userId = createdUser.$id;
  } catch (error) {
    if (providerErrorMatches(error, { code: 409, types: ["user_already_exists", "user_email_already_exists"] })) {
      return { status: 409, body: { code: "ACCOUNT_EXISTS", error: EXISTING_ACCOUNT_MESSAGE } };
    }
    if (isRateLimited(error)) throw rateLimitError();
    if (providerErrorMatches(error, { type: "user_count_exceeded" })) {
      throw new AuthError("PROVIDER_UNAVAILABLE", "New account registration is temporarily at capacity. Please try again later.");
    }
    if (providerErrorMatches(error, { types: ["user_password_strength", "user_password_pwned", "user_password_personal_data", "user_password_dictionary"] })) {
      throw new AuthError("INVALID_INPUT", "Choose a stronger password that does not contain personal information.");
    }
    if (providerErrorMatches(error, { code: 400 })) {
      throw new AuthError("INVALID_INPUT", "This email or password does not meet the signup requirements.");
    }
    throw new AuthError("PROVIDER_UNAVAILABLE", SERVICE_UNAVAILABLE);
  }

  let cookie: SessionCookieDirective;
  let account: Account;
  try {
    cookie = await createPasswordSession(deps, email, input.password);
    account = deps.sessionAccount(cookie.secret);
    const user = await account.get();
    if (user.$id !== userId || classifyAccount(user) === "anonymous") throw new Error("Signup session account mismatch");
  } catch {
    throw new AuthError("PROVIDER_UNAVAILABLE", "Your account was created, but sign-in could not be completed. Please sign in.");
  }
  let verificationEmailSent = false;
  try {
    await sendVerificationEmail(deps, account, userId);
    verificationEmailSent = true;
  } catch {
    // Registration succeeded. The user can request another link from the verification page.
  }
  return {
    status: 201,
    body: { ...VERIFICATION_REQUIRED, verificationEmailSent },
    cookie,
  };
}

export async function updateCurrentPassword(
  deps: AuthCoreDeps,
  sessionSecret: string | undefined,
  input: Readonly<{ currentPassword: string; newPassword: string; confirmPassword: string }>,
): Promise<AuthOperationResult> {
  if (!sessionSecret) throw new AuthError("AUTH_REQUIRED", "Sign in to update your password.");
  if (!input.currentPassword || input.currentPassword.length > 256) {
    throw new AuthError("INVALID_INPUT", "Current password is required.");
  }
  validateNewPassword(input.newPassword);
  validatePasswordConfirmation(input.newPassword, input.confirmPassword);
  if (input.currentPassword === input.newPassword) {
    throw new AuthError("INVALID_INPUT", "New password must be different from current password.");
  }

  const account = deps.sessionAccount(sessionSecret);
  try {
    const user = await account.get();
    const access = classifyAccount(user);
    if (access === "anonymous") {
      return { status: 401, body: { error: "Sign in to update your password." }, cookie: { action: "clear" } };
    }
    if (access === "verification-required") {
      return { status: 403, body: { code: "EMAIL_VERIFICATION_REQUIRED", error: "Verify your email to update your password." } };
    }
    await account.updatePassword({ password: input.newPassword, oldPassword: input.currentPassword });
  } catch (error) {
    if (providerErrorMatches(error, { types: ["user_invalid_credentials"] })) {
      return { status: 400, body: { error: "Current password is incorrect." } };
    }
    if (isInvalidSession(error)) {
      return { status: 401, body: { error: "Your session has expired. Sign in again." }, cookie: { action: "clear" } };
    }
    throw new AuthError("PROVIDER_UNAVAILABLE", "The authentication service is temporarily unavailable.");
  }

  return { status: 200, body: { updated: true }, cookie: { action: "clear" } };
}

export async function ensureProfile(
  tablesDB: AuthCoreDeps["tablesDB"],
  userId: string,
): Promise<{ userId: string; displayName: string }> {
  const profileRow = { databaseId: "hft", tableId: "profiles", rowId: userId };
  try {
    const existing = await tablesDB.getRow(profileRow);
    return { userId, displayName: String(existing.displayName) };
  } catch (error) {
    if (!providerErrorMatches(error, { code: 404 })) throw error;
  }
  const displayName = "Member";
  const now = new Date().toISOString();
  try {
    await tablesDB.createRow({
      ...profileRow,
      data: { displayName, version: 1, createdAt: now, updatedAt: now },
    });
    return { userId, displayName };
  } catch (error) {
    if (providerErrorMatches(error, { code: 409 })) {
      const raced = await tablesDB.getRow(profileRow);
      return { userId, displayName: String(raced.displayName) };
    }
    throw error;
  }
}

export async function loginWithPassword(
  deps: AuthCoreDeps,
  identityParts: readonly string[],
  input: Readonly<{ email: string; password: string }>,
): Promise<AuthOperationResult> {
  const email = normalizeEmail(input.email);
  await enforceAuthThrottle(deps.tablesDB, {
    secret: deps.authSecret,
    rule: AUTH_THROTTLE_RULES.login,
    identityParts,
  });
  try {
    const cookie = await createPasswordSession(deps, email, input.password);
    const user = await deps.sessionAccount(cookie.secret).get();
    const access = classifyAccount(user);
    if (access === "anonymous") return { status: 401, body: { error: GENERIC_CREDENTIALS_ERROR } };
    if (access === "verification-required") return { status: 200, body: VERIFICATION_REQUIRED, cookie };
    await ensureProfile(deps.tablesDB, user.$id);
    return { status: 200, body: { status: "authenticated", email: user.email }, cookie };
  } catch (error) {
    if (isRateLimited(error)) throw rateLimitError();
    if (isInvalidSession(error) || providerErrorMatches(error, { types: ["user_invalid_credentials", "user_password_reset_required"] })) {
      return { status: 401, body: { error: GENERIC_CREDENTIALS_ERROR } };
    }
    throw error;
  }
}

export async function restoreSessionState(deps: AuthCoreDeps, sessionSecret: string | undefined): Promise<AuthOperationResult> {
  if (!sessionSecret) return { status: 200, body: { status: "anonymous" } };
  try {
    const user = await deps.sessionAccount(sessionSecret).get();
    const access = classifyAccount(user);
    if (access === "anonymous") {
      return { status: 200, body: { status: "anonymous" }, cookie: { action: "clear" } };
    }
    if (access === "verification-required") return { status: 200, body: VERIFICATION_REQUIRED };
    const profile = await ensureProfile(deps.tablesDB, user.$id);
    return { status: 200, body: { status: "authenticated", email: user.email, displayName: profile.displayName } };
  } catch (error) {
    if (isInvalidSession(error)) {
      return { status: 200, body: { status: "anonymous" }, cookie: { action: "clear" } };
    }
    return { status: 503, body: { state: "provider-unavailable" } };
  }
}

async function sendVerificationEmail(deps: AuthCoreDeps, account: Account, userId: string): Promise<void> {
  await enforceAuthThrottle(deps.tablesDB, {
    secret: deps.authSecret,
    rule: AUTH_THROTTLE_RULES.verificationEmail,
    identityParts: [userId],
  });
  await account.createEmailVerification({ url: `${deps.origin}/verify-email` });
}

type VerificationIntent = Readonly<{ action: "send" } | { action: "confirm"; userId: string; secret: string }>;

export async function verifyCurrentEmail(
  deps: AuthCoreDeps,
  sessionSecret: string | undefined,
  intent: VerificationIntent,
): Promise<AuthOperationResult> {
  const signInRequired = { status: 401, body: { error: "Sign in with the account you want to verify." } };
  if (!sessionSecret) return signInRequired;
  const account = deps.sessionAccount(sessionSecret);
  try {
    const user = await account.get();
    const access = classifyAccount(user);
    if (access === "anonymous") return { ...signInRequired, cookie: { action: "clear" } };
    if (intent.action === "confirm" && intent.userId !== user.$id) return INVALID_VERIFICATION_LINK;
    if (access === "authenticated") return { status: 200, body: { verified: true } };
    if (intent.action === "send") {
      await sendVerificationEmail(deps, account, user.$id);
      return { status: 200, body: { sent: true } };
    }
    await enforceAuthThrottle(deps.tablesDB, {
      secret: deps.authSecret,
      rule: AUTH_THROTTLE_RULES.verificationConfirm,
      identityParts: [user.$id],
    });
    await account.updateEmailVerification({ userId: user.$id, secret: intent.secret });
    return { status: 200, body: { verified: true } };
  } catch (error) {
    if (isRateLimited(error)) throw rateLimitError();
    if (intent.action === "confirm" && providerErrorMatches(error, { types: ["user_invalid_token", "user_not_found"] })) return INVALID_VERIFICATION_LINK;
    if (isInvalidSession(error)) return { ...signInRequired, cookie: { action: "clear" } };
    throw new AuthError("PROVIDER_UNAVAILABLE", intent.action === "send"
      ? "We could not send a verification email. Please try again later."
      : "We could not verify your email. Please try again later.");
  }
}

export async function logoutCurrentSession(deps: AuthCoreDeps, sessionSecret: string | undefined): Promise<AuthOperationResult> {
  if (!sessionSecret) return { status: 200, body: { status: "anonymous" }, cookie: { action: "clear" } };
  let remoteRevocationUnconfirmed = false;
  try {
    await deps.sessionAccount(sessionSecret).deleteSession({ sessionId: "current" });
  } catch {
    remoteRevocationUnconfirmed = true;
  }
  return {
    status: 200,
    body: { status: "anonymous", ...(remoteRevocationUnconfirmed ? { warning: "Signed out on this device. Remote session revocation could not be confirmed." } : {}) },
    cookie: { action: "clear" },
  };
}

export async function initiatePasswordRecovery(deps: AuthCoreDeps, identityParts: readonly string[], rawEmail: string): Promise<AuthOperationResult> {
  const email = normalizeEmail(rawEmail);
  await enforceAuthThrottle(deps.tablesDB, {
    secret: deps.authSecret,
    rule: AUTH_THROTTLE_RULES.recovery,
    identityParts: [...identityParts, email],
  });
  const generic = { status: 200 as const, body: { sent: true } };
  try {
    await deps.adminAccount().createRecovery({ email, url: `${deps.origin}/reset-password` });
    return generic;
  } catch (error) {
    if (providerErrorMatches(error, { types: ["user_not_found", "user_blocked"] })) return generic;
    if (isRateLimited(error)) throw rateLimitError();
    throw error;
  }
}

export async function completePasswordReset(
  deps: AuthCoreDeps,
  identityParts: readonly string[],
  input: Readonly<{ userId: string; secret: string; password: string }>,
): Promise<AuthOperationResult> {
  await enforceAuthThrottle(deps.tablesDB, {
    secret: deps.authSecret,
    rule: AUTH_THROTTLE_RULES.reset,
    identityParts: [...identityParts, input.userId],
  });
  try {
    await deps.adminAccount().updateRecovery({ userId: input.userId, secret: input.secret, password: input.password });
  } catch (error) {
    if (isRateLimited(error)) throw rateLimitError();
    if (providerErrorMatches(error, { code: 400 }) || providerErrorMatches(error, { types: ["user_invalid_token", "user_not_found"] })) {
      return { status: 400, body: { error: "This recovery link is invalid or has expired." } };
    }
    throw error;
  }
  return { status: 200, body: { reset: true }, cookie: { action: "clear" } };
}

export { deriveAuthThrottleIdentity };
