import type { NextRequest } from "next/server";
import { householdId, type HouseholdId } from "@/domain/shared/identifiers";
import { listMembers } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { parseSearch, readInput, runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runProductRead(request, async (context) => {
    const input = parseSearch(request, { householdId: readInput.householdId });
    return listMembers(context, householdId(String(input.householdId)) as HouseholdId);
  });
}
