import type { NextRequest } from "next/server";
import { editExpense } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { expenseEditInput } from "@/infrastructure/appwrite/runtime/financial-command-input.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, expenseEditInput, (context, input) => {
    const intentSeed = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "commandId"));
    return runWithCommandEnvelope(
      { commandType: "edit-expense", commandId: String(input.commandId), intentSeed },
      () => editExpense(context, input),
    );
  });
}
