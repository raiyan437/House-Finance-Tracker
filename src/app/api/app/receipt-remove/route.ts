import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApplicationError } from "@/application/errors/application-error";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const input = z.object({
  receiptId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/u),
  commandId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/u),
}).strict();

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, input, (context, parsed) => {
    if (!context.capabilities.receiptMutations) throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    return context.receiptOperations.remove({
      receiptId: String(parsed.receiptId),
      commandId: String(parsed.commandId),
    });
  });
}
