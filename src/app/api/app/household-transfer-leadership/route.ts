import type { NextRequest } from "next/server";
import { z } from "zod";
import { transferLeadership } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";

export const dynamic = "force-dynamic";

const schema = z.object({ memberId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/, "A valid identifier is required."), commandId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/, "A valid identifier is required.") });

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, schema, async (context, input) => {
    const intentSeed = { memberId: String(input.memberId) };
    return runWithCommandEnvelope({ commandType: "transfer-leadership", commandId: String(input.commandId), intentSeed }, () =>
      transferLeadership(context, String(input.memberId)));
  });
}
