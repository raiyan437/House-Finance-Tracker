import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { AuthError } from "@/infrastructure/appwrite/auth/auth-errors.server";
import { serializeClearedSessionCookie, SESSION_COOKIE_NAME } from "./session-cookie";
import type { AuthOperationResult } from "./account-service.server";
import { requestHasTrustedOrigin, TrustedOriginConfigurationError } from "../trusted-origin.server";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export function assertSameOrigin(request: NextRequest): boolean {
  return requestHasTrustedOrigin(request, request.method !== "GET" && request.method !== "HEAD");
}

export async function readSessionSecret(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value || undefined;
}

function applyCookie(response: NextResponse, cookie: AuthOperationResult["cookie"]): void {
  if (!cookie) return;
  const secure = process.env.NODE_ENV === "production";
  if (cookie.action === "set") {
    // WebKit rejects lowercase SameSite values; emit the canonical capitalized form.
    const attributes = `Path=/; Expires=${new Date(cookie.expire).toUTCString()}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
    response.headers.append("set-cookie", `${SESSION_COOKIE_NAME}=${cookie.secret}; ${attributes}`);
    return;
  }
  response.headers.append("set-cookie", serializeClearedSessionCookie(secure));
}

export async function runAuthMutation(
  request: NextRequest,
  handler: () => Promise<AuthOperationResult>,
): Promise<NextResponse> {
  try {
    if (!assertSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin requests are not permitted." }, { status: 403, headers: NO_STORE_HEADERS });
    }
    const result = await handler();
    const response = NextResponse.json(result.body, { status: result.status, headers: NO_STORE_HEADERS });
    applyCookie(response, result.cookie);
    return response;
  } catch (error) {
    if (error instanceof TrustedOriginConfigurationError) {
      return NextResponse.json({ error: "The authentication service is temporarily unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
    }
    if (error instanceof AuthError) {
      const status = {
        RATE_LIMITED: 429,
        AUTH_REQUIRED: 401,
        SESSION_INVALID: 401,
        EMAIL_NOT_PERMITTED: 403,
        PROVIDER_UNAVAILABLE: 503,
        INVALID_INPUT: 400,
      }[error.code];
      return NextResponse.json({ error: error.message }, { status, headers: NO_STORE_HEADERS });
    }
    console.error("[auth-route] unexpected authentication failure", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "The authentication service is temporarily unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
