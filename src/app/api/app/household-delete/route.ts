import type { NextRequest } from "next/server";
import { z } from "zod";
import { deleteHousehold } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";

export const dynamic = "force-dynamic";

const schema = z.object({ commandId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/, "A valid identifier is required.") });

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, schema, async (context, input) => {
    return runWithCommandEnvelope({ commandType: "delete-household", commandId: String(input.commandId), intentSeed: {} }, () =>
      deleteHousehold(context));
  });
}
