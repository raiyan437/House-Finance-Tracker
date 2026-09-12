import type { NextRequest } from "next/server";
import { getNotifications } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("offset") ?? "0";
  const offset = Number(raw);
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000) return new Response(JSON.stringify({ error: "The notification page is invalid.", code: "INVALID_INPUT" }), { status: 400, headers: { "cache-control": "no-store", "content-type": "application/json" } });
  return runProductRead(request, (context) => getNotifications(context, offset));
}
