import type { NextRequest } from "next/server";
import { transitionSettlement } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { settlementTransitionInput } from "@/infrastructure/appwrite/runtime/financial-command-input.server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, settlementTransitionInput, (context, input) => {
    const intentSeed = { settlementId: String(input.settlementId), status: "rejected" };
    return runWithCommandEnvelope(
      { commandType: "reject-settlement", commandId: String(input.commandId), intentSeed },
      () => transitionSettlement(context, String(input.settlementId), "rejected", String(input.commandId)),
    );
  });
}
