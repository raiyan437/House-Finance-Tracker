import type { NextRequest } from "next/server";
import { createExpense } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { expenseCreateInput } from "@/infrastructure/appwrite/runtime/financial-command-input.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, expenseCreateInput, (context, input) =>
    runWithCommandEnvelope(
      { commandType: "create-expense", commandId: String(input.commandId), intentSeed: input },
      () => createExpense(context, input),
    ));
}
