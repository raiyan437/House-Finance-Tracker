import type { NextRequest } from "next/server";
import { getMyCards } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runProductRead(request, getMyCards);
}
