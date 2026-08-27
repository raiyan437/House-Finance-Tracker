import type { NextRequest } from "next/server";
import { createSettlement } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { settlementCreateInput } from "@/infrastructure/appwrite/runtime/financial-command-input.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, settlementCreateInput, (context, input) => {
    const recommendation = input.recommendation as Record<string, unknown>;
    return runWithCommandEnvelope(
      { commandType: "create-pending-settlement", commandId: String(input.commandId), intentSeed: recommendation },
      () => createSettlement(context, recommendation, String(input.commandId)),
    );
  });
}
