import type { NextRequest } from "next/server";
import { z } from "zod";
import { createHousehold } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { commandIdentifierInput, householdNameInput } from "@/infrastructure/appwrite/runtime/household-command-input.server";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: householdNameInput,
  code: z.string().regex(/^\d{9}$/),
  commandId: commandIdentifierInput,
});

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, schema, async (context, input) => {
    const intentSeed = { name: String(input.name), code: String(input.code) };
    return runWithCommandEnvelope({ commandType: "create-household", commandId: String(input.commandId), intentSeed }, () =>
      createHousehold(context, String(input.name), String(input.code), String(input.commandId)));
  });
}
