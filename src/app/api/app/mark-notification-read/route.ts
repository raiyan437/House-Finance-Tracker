import type { NextRequest } from "next/server";
import { z } from "zod";
import { markNotificationRead } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

const schema = z.object({ notificationId: z.string().min(1).max(64) });

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, schema, (context, input) => markNotificationRead(context, String(input.notificationId)));
}
