import type { NextRequest } from "next/server";
import { runReceiptUpload } from "@/infrastructure/appwrite/runtime/receipt-route.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return runReceiptUpload(request);
}
