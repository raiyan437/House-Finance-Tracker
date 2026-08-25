import type { NextRequest } from "next/server";
import { settlementId, type SettlementId } from "@/domain/shared/identifiers";
import { getPendingSettlementPreview } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { parseSearch, readInput, runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runProductRead(request, async (context) => {
    const input = parseSearch(request, { id: readInput.id });
    return getPendingSettlementPreview(context, settlementId(String(input.id)) as SettlementId);
  });
}
