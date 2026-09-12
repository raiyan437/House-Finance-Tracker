import type { NextRequest } from "next/server";
import { z } from "zod";
import { markAllNotificationsRead } from "@/infrastructure/appwrite/runtime/product-commands.server";
import { runTrustedCommand } from "@/infrastructure/appwrite/runtime/read-route.server";

export const dynamic = "force-dynamic";

export const markAllNotificationsReadSchema = z.object({}).strict();

export async function POST(request: NextRequest) {
  return runTrustedCommand(request, markAllNotificationsReadSchema, (context) => markAllNotificationsRead(context));
}
