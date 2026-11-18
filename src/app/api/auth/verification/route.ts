import type { NextRequest } from "next/server";
import { z } from "zod";
import { verifyCurrentEmail } from "@/infrastructure/appwrite/auth/account-service.server";
import { buildAuthCoreDeps } from "@/infrastructure/appwrite/auth/deps.server";
import { readSessionSecret, runAuthMutation } from "@/infrastructure/appwrite/auth/route-helpers.server";

const schema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("send") }),
  z.strictObject({
    action: z.literal("confirm"),
    userId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/),
    secret: z.string().min(1).max(256),
  }),
]);

export async function POST(request: NextRequest) {
  return runAuthMutation(request, async () => {
    const parsed = schema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return { status: 400, body: { error: "The verification request is invalid. Request a new link." } };
    return verifyCurrentEmail(buildAuthCoreDeps(), await readSessionSecret(), parsed.data);
  });
}
