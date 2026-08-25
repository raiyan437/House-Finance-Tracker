import { z } from "zod";
import type { NextRequest } from "next/server";
import { completePasswordReset } from "@/infrastructure/appwrite/auth/account-service.server";
import { buildAuthCoreDeps } from "@/infrastructure/appwrite/auth/deps.server";
import { runAuthMutation } from "@/infrastructure/appwrite/auth/route-helpers.server";

const schema = z.object({ userId: z.string().min(8), secret: z.string().min(8), password: z.string().min(8).max(256) });

export async function POST(request: NextRequest) {
  return runAuthMutation(request, async () => {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return { status: 400, body: { error: "Invalid reset details." } };
    const deps = buildAuthCoreDeps(new URL(request.url).origin);
    const ipAddress = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    return completePasswordReset(deps, [ipAddress], parsed.data);
  });
}
