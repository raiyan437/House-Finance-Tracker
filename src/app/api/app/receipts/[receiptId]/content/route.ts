import type { NextRequest } from "next/server";
import { runReceiptContentRead } from "@/infrastructure/appwrite/runtime/receipt-route.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ receiptId: string }> },
) {
  const { receiptId } = await context.params;
  return runReceiptContentRead(request, receiptId);
}
