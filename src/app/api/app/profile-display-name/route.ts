import type { NextRequest } from "next/server";
import { z } from "zod";
import { runWithCommandEnvelope } from "@/infrastructure/appwrite/runtime/command-envelope.server";
import { commandIdentifierInput } from "@/infrastructure/appwrite/runtime/household-command-input.server";
import { updateProfileDisplayName } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from "@/domain/records/domain-records";

export const dynamic = "force-dynamic";

export const profileDisplayNameCommandSchema = z.object({
  displayName: z.string().transform((value) => value.trim()).pipe(
    z.string().min(1).max(PROFILE_DISPLAY_NAME_MAX_LENGTH, "Display name must be 20 characters or fewer."),
  ),
  expectedVersion: z.number().int().safe().min(1),
  commandId: commandIdentifierInput,
}).strict();

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, profileDisplayNameCommandSchema, (context, input) => {
    const displayName = String(input.displayName);
    const expectedVersion = Number(input.expectedVersion);
    const commandId = String(input.commandId);
    return runWithCommandEnvelope(
      { commandType: "update-profile-display-name", commandId, intentSeed: { displayName } },
      () => updateProfileDisplayName(context, { displayName, expectedVersion, commandId }),
    );
  });
}
