import { z } from "zod";
import type { NextRequest } from "next/server";
import { initiatePasswordRecovery } from "@/infrastructure/appwrite/auth/account-service.server";
import { buildAuthCoreDeps } from "@/infrastructure/appwrite/auth/deps.server";
import { runAuthMutation } from "@/infrastructure/appwrite/auth/route-helpers.server";

const schema = z.object({ email: z.string() });

export async function POST(request: NextRequest) {
  return runAuthMutation(request, async () => {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return { status: 200, body: { sent: true } };
    const deps = buildAuthCoreDeps();
    const ipAddress = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    return initiatePasswordRecovery(deps, [ipAddress], parsed.data.email);
  });
}
