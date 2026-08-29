import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { AuthError } from "@/infrastructure/appwrite/auth/auth-errors.server";
import { serializeClearedSessionCookie, SESSION_COOKIE_NAME } from "./session-cookie";
import { requestHasTrustedOrigin, TrustedOriginConfigurationError } from "../trusted-origin.server";

export interface AuthRouteResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly cookie?: { action: "set" | "clear"; secret?: string; expire?: string };
}

export function assertSameOrigin(request: NextRequest): boolean {
  return requestHasTrustedOrigin(request, request.method !== "GET" && request.method !== "HEAD");
}

export async function readSessionSecret(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value || undefined;
}

function applyCookie(response: NextResponse, cookie: AuthRouteResult["cookie"]): void {
  if (!cookie) return;
  const secure = process.env.NODE_ENV === "production";
  if (cookie.action === "set") {
    // WebKit rejects lowercase SameSite values; emit the canonical capitalized form.
    const attributes = `Path=/; Expires=${new Date(cookie.expire ?? 0).toUTCString()}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
    response.headers.append("set-cookie", `${SESSION_COOKIE_NAME}=${cookie.secret ?? ""}; ${attributes}`);
    return;
  }
  response.headers.append("set-cookie", serializeClearedSessionCookie(secure));
}

export async function runAuthMutation(
  request: NextRequest,
  handler: () => Promise<AuthRouteResult>,
): Promise<NextResponse> {
  try {
    if (!assertSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin requests are not permitted." }, { status: 403 });
    }
    const result = await handler();
    const response = NextResponse.json(result.body ?? {}, { status: result.status });
    applyCookie(response, result.cookie);
    return response;
  } catch (error) {
    if (error instanceof TrustedOriginConfigurationError) {
      return NextResponse.json({ error: "The authentication service is temporarily unavailable." }, { status: 503 });
    }
    if (error instanceof AuthError) {
      const status = error.code === "RATE_LIMITED" ? 429 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[auth-route]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The authentication service is temporarily unavailable." }, { status: 503 });
  }
}
