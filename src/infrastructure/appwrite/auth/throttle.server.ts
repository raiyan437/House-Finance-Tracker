import { createHmac } from "node:crypto";
import { AppwriteException, type TablesDB } from "node-appwrite";
import { AuthError } from "./auth-errors.server";
import { guardRowId } from "../ids";

function providerErrorMatches(error: unknown, match: Readonly<{ code?: number }>): boolean {
  const candidate = error as { code?: number } | null;
  if (!candidate || typeof candidate !== "object") return false;
  return error instanceof AppwriteException ? candidate.code === match.code : typeof candidate.code === "number" && candidate.code === match.code;
}

export interface AuthThrottleRule {
  readonly scope: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export function deriveAuthThrottleIdentity(secret: string, scope: string, identityParts: readonly string[]): string {
  return createHmac("sha256", secret).update([scope, ...identityParts].join("|")).digest("hex");
}

export async function enforceAuthThrottle(
  tablesDB: TablesDB,
  input: Readonly<{
    secret: string;
    rule: AuthThrottleRule;
    identityParts: readonly string[];
    now?: Date;
  }>,
): Promise<void> {
  const now = input.now ?? new Date();
  const identity = deriveAuthThrottleIdentity(input.secret, input.rule.scope, input.identityParts);
  const bucket = Math.floor(now.getTime() / (input.rule.windowSeconds * 1000));
  const rowId = guardRowId(`auth-rate:${input.rule.scope}:${identity}:${bucket}`);
  const logicalKey = `auth-rate:${input.rule.scope}:${identity}:${bucket}`;
  try {
    await tablesDB.createRow({
      databaseId: "hft",
      tableId: "coordination_guards",
      rowId,
      data: { logicalKey, counter: 1, version: 0, createdAt: now.toISOString() },
    });
    return;
  } catch (error) {
    if (!providerErrorMatches(error, { code: 409 })) throw error;
  }
  const incremented = await tablesDB.incrementRowColumn({
    databaseId: "hft",
    tableId: "coordination_guards",
    rowId,
    column: "counter",
    value: 1,
  });
  const updated = Number((incremented as { counter?: number | bigint }).counter ?? 0);
  if (updated > input.rule.limit) {
    throw new AuthError("RATE_LIMITED", "Too many attempts. Please try again later.");
  }
}
