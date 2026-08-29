import type { NextRequest } from "next/server";
import { householdId, type HouseholdId } from "@/domain/shared/identifiers";
import { calendarMonth } from "@/application/analytics/calendar-month";
import { getDashboard } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { parseSearch, readInput, runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runProductRead(request, async (context) => {
    const input = parseSearch(request, { householdId: readInput.householdId, month: readInput.month });
    return getDashboard(context, householdId(String(input.householdId)) as HouseholdId, calendarMonth(String(input.month)));
  });
}
