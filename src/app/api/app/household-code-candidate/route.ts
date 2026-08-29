import type { NextRequest } from "next/server";
import { generateCodeCandidate } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runProductRead(request, async (context) => {
    await context.enforceHouseCodeThrottle([context.actor.userId, clientIp(request)]);
    return generateCodeCandidate(context);
  });
}

function clientIp(request: NextRequest): string {
  return (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim() || "local";
}
