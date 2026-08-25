import type { NextRequest } from "next/server";
import { householdId, type HouseholdId } from "@/domain/shared/identifiers";
import { listExpenses } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { parseSearch, readInput, runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runProductRead(request, async (context) => {
    const input = parseSearch(request, { householdId: readInput.householdId, includeDeleted: readInput.includeDeleted });
    return listExpenses(context, householdId(String(input.householdId)) as HouseholdId, input.includeDeleted === "true");
  });
}
