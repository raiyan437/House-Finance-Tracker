import { AppwriteException, type Account } from "node-appwrite";
import { AuthError } from "./auth-errors.server";
import type { AccountEmailConfiguration } from "../config";
import { deriveAuthThrottleIdentity, enforceAuthThrottle } from "./throttle.server";

export interface AuthCoreDeps {
  readonly adminAccount: () => Account;
  readonly sessionAccount: (sessionSecret: string) => Account;
  readonly tablesDB: import("node-appwrite").TablesDB;
  readonly accountEmails: AccountEmailConfiguration;
  readonly authSecret: string;
  readonly origin: string;
}

export interface AuthCookieDirective {
  readonly action: "set" | "clear";
  readonly secret?: string;
  readonly expire?: string;
}

export interface AuthOperationResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly cookie?: AuthCookieDirective;
}

export type AuthAccessState = "authenticated" | "anonymous" | "pending-bootstrap" | "provider-unavailable";


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

export const AUTH_THROTTLE_RULES = {
  login: { scope: "auth-login", limit: 10, windowSeconds: 900 },
  recovery: { scope: "auth-recovery", limit: 3, windowSeconds: 3600 },
  reset: { scope: "auth-reset", limit: 5, windowSeconds: 900 },
  /** Approved with the Phase 13 rate-limit table; shared by lookup and generation reads. */
  houseCodeLookup: { scope: "house-code", limit: 10, windowSeconds: 3600 },
} as const;

function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("INVALID_INPUT", "A valid email is required.");
  return email;
}

function isApprovedAccount(accountEmails: AccountEmailConfiguration, email: string): boolean {
  return accountEmails.status === "enabled" && accountEmails.emails.includes(email);
}

function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "Member";
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

export async function ensureProfile(
  tablesDB: AuthCoreDeps["tablesDB"],
  user: Readonly<{ id: string; email: string }>,
  intendedDisplayName?: string,
): Promise<{ userId: string; displayName: string }> {
  try {
    const existing = await tablesDB.getRow({ databaseId: "hft", tableId: "profiles", rowId: user.id });
    return { userId: user.id, displayName: String(existing.displayName) };
  } catch (error) {
    if (!providerErrorMatches(error, { code: 404 })) throw error;
  }
  const displayName = intendedDisplayName?.trim() || displayNameFromEmail(user.email);
  try {
    await tablesDB.createRow({
      databaseId: "hft",
      tableId: "profiles",
      rowId: user.id,
      data: { displayName, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    });
    return { userId: user.id, displayName };
  } catch (error) {
    if (providerErrorMatches(error, { code: 409 })) {
      const raced = await tablesDB.getRow({ databaseId: "hft", tableId: "profiles", rowId: user.id });
      return { userId: user.id, displayName: String(raced.displayName) };
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
  if (!isApprovedAccount(deps.accountEmails, email)) {
    return { status: 401, body: { error: GENERIC_CREDENTIALS_ERROR } };
  }
  let session: { secret: string; expire: string };
  try {
    session = await deps.adminAccount().createEmailPasswordSession({ email, password: input.password });
  } catch (error) {
    if (providerErrorMatches(error, { types: ["user_invalid_credentials", "user_not_found"] })) {
      return { status: 401, body: { error: GENERIC_CREDENTIALS_ERROR } };
    }
    throw error;
  }
  const sessionAccount = deps.sessionAccount(session.secret);
  const user = await sessionAccount.get();
  await ensureProfile(deps.tablesDB, { id: user.$id, email: user.email });
  const state: AuthAccessState = "authenticated";
  return {
    status: 200,
    body: { status: state, email: user.email },
    cookie: { action: "set", secret: session.secret, expire: session.expire },
  };
}

export async function restoreSessionState(deps: AuthCoreDeps, sessionSecret: string | undefined): Promise<AuthOperationResult & { cookie?: AuthCookieDirective }> {
  if (!sessionSecret) return { status: 200, body: { status: "anonymous" } };
  try {
    const user = await deps.sessionAccount(sessionSecret).get();
    if (!isApprovedAccount(deps.accountEmails, user.email.trim().toLowerCase())) {
      return { status: 200, body: { status: "anonymous" }, cookie: { action: "clear" } };
    }
    const profile = await ensureProfile(deps.tablesDB, { id: user.$id, email: user.email });
    const state: AuthAccessState = "authenticated";
    return { status: 200, body: { status: state, email: user.email, displayName: profile.displayName } };
  } catch (error) {
    if (
      (error instanceof AuthError && error.code === "SESSION_INVALID") ||
      providerErrorMatches(error, { code: 401, types: ["user_unauthorized", "general_unauthorized_scope"] })
    ) {
      return { status: 200, body: { status: "anonymous" }, cookie: { action: "clear" } };
    }
    return { status: 503, body: { state: "provider-unavailable" } };
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
  if (!isApprovedAccount(deps.accountEmails, email)) return generic;
  try {
    await deps.adminAccount().createRecovery({ email, url: `${deps.origin}/reset-password` });
    return generic;
  } catch (error) {
    if (providerErrorMatches(error, { code: 404, types: ["user_not_found"] })) return generic;
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
    if (providerErrorMatches(error, { code: 400 })) {
      return { status: 400, body: { error: "This recovery link is invalid or has expired." } };
    }
    throw error;
  }
  return { status: 200, body: { reset: true }, cookie: { action: "clear" } };
}

export { deriveAuthThrottleIdentity };
