import type { NextRequest } from "next/server";
import { createExpenseComment } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { expenseCommentCreateInput } from "@/infrastructure/appwrite/runtime/financial-command-input.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, expenseCommentCreateInput, (context, input) =>
    runWithCommandEnvelope(
      { commandType: "create-expense-comment", commandId: String(input.commandId), intentSeed: { expenseId: input.expenseId, body: String(input.body).trim() } },
      () => createExpenseComment(context, String(input.expenseId), String(input.body), String(input.commandId)),
    ));
}
