import type { NextRequest } from "next/server";
import { deleteExpense } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { expenseDeleteInput } from "@/infrastructure/appwrite/runtime/financial-command-input.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, expenseDeleteInput, (context, input) =>
    runWithCommandEnvelope(
      { commandType: "delete-expense", commandId: String(input.commandId), intentSeed: { expenseId: input.expenseId, expectedRevision: input.expectedRevision } },
      () => deleteExpense(context, String(input.expenseId), Number(input.expectedRevision), String(input.commandId)),
    ));
}
