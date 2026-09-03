import type { NextRequest } from "next/server";
import { expenseId } from "@/domain/shared/identifiers";
import { parseSearch, readInput, runProductRead } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runProductRead(request, async (context) => {
    const input = parseSearch(request, { id: readInput.id });
    return context.application.expenses.listExpenseComments(expenseId(String(input.id)));
  });
}
