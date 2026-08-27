import type { NextRequest } from "next/server";
import { z } from "zod";
import { removeCard } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { commandIdentifierInput } from "@/infrastructure/appwrite/runtime/household-command-input.server";

export const dynamic = "force-dynamic";

const schema = z.object({
  cardId: commandIdentifierInput,
  expectedAction: z.enum(["delete", "archive"]),
  commandId: commandIdentifierInput,
});

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, schema, async (context, input) => {
    const intentSeed = { cardId: String(input.cardId), expectedAction: input.expectedAction as "delete" | "archive" };
    return runWithCommandEnvelope(
      { commandType: "remove-card", commandId: String(input.commandId), intentSeed },
      () => removeCard(context, intentSeed.cardId, intentSeed.expectedAction, String(input.commandId)),
    );
  });
}
