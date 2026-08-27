import type { NextRequest } from "next/server";
import { z } from "zod";
import { CARD_DESIGN_IDS } from "@/domain/cards/card-color";
import { createCard } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { commandIdentifierInput } from "@/infrastructure/appwrite/runtime/household-command-input.server";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["debit", "credit"]),
  colorId: z.enum(CARD_DESIGN_IDS),
  commandId: commandIdentifierInput,
});

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, schema, async (context, input) => {
    const intentSeed = { name: String(input.name), type: input.type as "debit" | "credit", colorId: String(input.colorId) };
    return runWithCommandEnvelope(
      { commandType: "create-card", commandId: String(input.commandId), intentSeed },
      () => createCard(context, { ...intentSeed, commandId: String(input.commandId) }),
    );
  });
}
