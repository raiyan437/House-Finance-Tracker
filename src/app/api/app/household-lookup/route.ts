import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApplicationError } from "@/application/errors/application-error";
import { lookupHouseholdForJoin } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { readInput, runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: readInput.code });

export async function POST(request: NextRequest) {
  return runProductRead(request, async (context) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      throw new ApplicationError(
        "INVALID_HOUSEHOLD_CODE",
        "A household code must contain exactly nine digits.",
      );
    }
    // Approved rate limit: house-code lookups are throttled per opaque
    // actor/IP identity before any provider query runs.
    await context.enforceHouseCodeThrottle([context.actor.userId, clientIp(request)]);
    return lookupHouseholdForJoin(context, parsed.data.code);
  });
}

function clientIp(request: NextRequest): string {
  return (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim() || "local";
}
