import type { NextRequest } from "next/server";
import { expenseId, type ExpenseId } from "@/domain/shared/identifiers";
import { getExpense } from "@/infrastructure/appwrite/runtime/product-reads.server";
import { parseSearch, readInput, runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runProductRead(request, async (context) => {
    const input = parseSearch(request, { id: readInput.id });
    return getExpense(context, expenseId(String(input.id)) as ExpenseId);
  });
}
