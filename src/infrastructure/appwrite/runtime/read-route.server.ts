import "server-only";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApplicationError, BackdatedExpenseConfirmationRequiredError } from "@/application/errors/application-error";
import { serializeWithBigInt } from "@/application/transport/json-bigint";
import { DomainError } from "@/domain/shared/domain-error";
import { TransactionFailure } from "./tx-errors.server";
import { AuthError } from "../auth/auth-errors.server";
import { SESSION_COOKIE_NAME } from "../auth/session-cookie";
import { ActorRequiredError, type TrustedActorResolution } from "./actor.server";
import { buildProductRequestContext, requireActor, resolveTrustedActor, type ProductRequestContext } from "./context.server";
import { requestHasTrustedOrigin, TrustedOriginConfigurationError } from "../trusted-origin.server";

const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export function mapReadError(error: unknown): { status: number; body: Record<string, unknown> } | undefined {
  if (error instanceof ActorRequiredError) {
    return { status: 401, body: { error: "Sign in to continue." } };
  }
  if (error instanceof AuthError) {
    return error.code === "RATE_LIMITED"
      ? { status: 429, body: { error: error.message } }
      : { status: 400, body: { error: error.message } };
  }
  if (error instanceof ApplicationError || error instanceof DomainError) {
    if (error instanceof BackdatedExpenseConfirmationRequiredError) {
      return {
        status: 409,
        body: {
          error: error.message,
          code: error.code,
          confirmationToken: error.confirmationToken,
        },
      };
    }
    switch (error.code) {
      case "NOT_FOUND":
        return { status: 404, body: { error: "Not found.", code: error.code } };
      case "CONFLICT":
      case "HOUSEHOLD_STATE_CHANGED":
      case "EXPENSE_VERSION_CONFLICT":
      case "IDEMPOTENCY_KEY_REUSED":
      case "IDEMPOTENCY_IN_PROGRESS":
      case "RECEIPT_COUNT_LIMIT_EXCEEDED":
      case "RECEIPT_USER_QUOTA_EXCEEDED":
      case "RECEIPT_PROJECT_CAPACITY_EXCEEDED":
        return { status: 409, body: { error: error.message, code: error.code } };
      case "INVALID_HOUSEHOLD_CODE":
      case "INVALID_INPUT":
      case "RECEIPT_PRIVATE_ACCESS_FORBIDDEN":
      case "RECEIPT_CONTENT_MISMATCH":
        return { status: 400, body: { error: error.message, code: error.code } };
      case "MALFORMED_PERSISTED_DATA":
        console.error("[product-read] malformed persisted data", { store: error.context?.store ?? "unknown" });
        return { status: 500, body: { error: "Stored data could not be interpreted." } };
      case "PERSISTENCE_FAILURE":
        return { status: 503, body: { error: "The production data plane is temporarily unavailable." } };
      default:
        return { status: 400, body: { error: error.message } };
    }
  }
  return undefined;
}

async function currentSessionSecret(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value || undefined;
}

export async function resolveReadContext(): Promise<
  { status: "ok"; context: ProductRequestContext } | { status: Response }
> {
  let resolution: TrustedActorResolution;
  try {
    resolution = await resolveTrustedActor(await currentSessionSecret());
  } catch {
    resolution = { status: "provider-unavailable" };
  }
  if (resolution.status === "provider-unavailable") {
    return { status: new NextResponse(JSON.stringify({ error: "The service is temporarily unavailable." }), { status: 503, headers: NO_STORE_HEADERS }) };
  }
  try {
    return { status: "ok", context: buildProductRequestContext(requireActor(resolution)) };
  } catch (error) {
    const mapped = mapReadError(error);
    if (mapped) return { status: new NextResponse(JSON.stringify(mapped.body), { status: mapped.status, headers: NO_STORE_HEADERS }) };
    throw error;
  }
}

/**
 * Trusted same-origin envelope for every production read endpoint: identical
 * session verification, sanitized error mapping, and no-store caching.
 */
export async function runProductRead<T>(request: NextRequest, handler: (context: ProductRequestContext) => Promise<T>): Promise<NextResponse> {
  try {
    if (!requestHasTrustedOrigin(request, false)) {
      return NextResponse.json({ error: "Cross-origin requests are not permitted." }, { status: 403, headers: NO_STORE_HEADERS });
    }
    const resolved = await resolveReadContext();
    if (resolved.status !== "ok") return resolved.status as NextResponse;
    const data = await handler(resolved.context);
    return new NextResponse(serializeWithBigInt({ data }), {
      status: 200,
      headers: { ...NO_STORE_HEADERS, "content-type": "application/json" },
    });
  } catch (error) {
    if (error instanceof TrustedOriginConfigurationError) {
      return NextResponse.json({ error: "The service is temporarily unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
    }
    const mapped = mapReadError(error);
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status, headers: NO_STORE_HEADERS });
    console.error("[product-read]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The service is temporarily unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}

export function assertSameOrigin(request: NextRequest, requireOrigin = true): boolean {
  return requestHasTrustedOrigin(request, requireOrigin);
}

/**
 * Trusted same-origin envelope for production commands (R2). POST-only with
 * the identical session verification; provider transaction failures map per
 * the frozen Gate A semantics:
 * - conflict  -> 409 typed stale-state conflict
 * - expired   -> 503 sanitized busy (fresh transaction on retry)
 * - limit     -> 503 internal invariant failure (never partially continued)
 */
export async function runTrustedCommand<T>(
  request: NextRequest,
  schema: z.ZodType,
  handler: (context: ProductRequestContext, input: Record<string, unknown>) => Promise<T>,
): Promise<NextResponse> {
  try {
    if (!assertSameOrigin(request)) {
      return NextResponse.json({ error: "Cross-origin requests are not permitted." }, { status: 403, headers: NO_STORE_HEADERS });
    }
  } catch (error) {
    if (error instanceof TrustedOriginConfigurationError) {
      return NextResponse.json({ error: "The service is temporarily unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
    }
    throw error;
  }
  let body: Record<string, unknown> = {};
  try {
    const parsedBody = await request.json();
    if (parsedBody !== null && typeof parsedBody === "object") body = parsedBody as Record<string, unknown>;
  } catch {
    body = {};
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "The command payload is invalid." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  try {
    const resolved = await resolveReadContext();
    if (resolved.status !== "ok") return resolved.status as NextResponse;
    const data = await handler(resolved.context, parsed.data as Record<string, unknown>);
    return new NextResponse(serializeWithBigInt({ data }), {
      status: 200,
      headers: { ...NO_STORE_HEADERS, "content-type": "application/json" },
    });
  } catch (error) {
    if (error instanceof TransactionFailure) {
      const statusByKind = { conflict: 409, expired: 503, limit: 503 } as const;
      const messageByKind: Record<TransactionFailure["kind"], string> = {
        conflict: "The household state changed concurrently. Review the current state and retry.",
        expired: "The service is temporarily busy. Please retry shortly.",
        limit: "The service could not complete this operation safely.",
      };
      return NextResponse.json(
        { error: messageByKind[error.kind], kind: error.kind },
        { status: statusByKind[error.kind], headers: NO_STORE_HEADERS },
      );
    }
    const mapped = mapReadError(error);
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status, headers: NO_STORE_HEADERS });
    console.error("[product-command]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The service is temporarily unavailable." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
/** Shared strict query/JSON input schemas for the read surface. */
export const readInput = {
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/, "A valid identifier is required."),
  householdId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/, "A valid household identifier is required."),
  month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, "A calendar month uses YYYY-MM."),
  includeDeleted: z.enum(["true", "false"]).default("false"),
  code: z.string().regex(/^\d{9}$/, "A household code must contain exactly nine digits."),
} as const;

export function parseSearch(request: NextRequest, schema: z.ZodRawShape): Record<string, unknown> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = z.object(schema).safeParse(params);
  if (!parsed.success) {
    throw new ApplicationError("INVALID_INPUT", "The request parameters are invalid.");
  }
  return parsed.data;
}
