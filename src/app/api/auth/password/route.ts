import { z } from "zod";
import type { NextRequest } from "next/server";
import { updateCurrentPassword } from "@/infrastructure/appwrite/auth/account-service.server";
import { buildAuthCoreDeps } from "@/infrastructure/appwrite/auth/deps.server";
import { readSessionSecret, runAuthMutation } from "@/infrastructure/appwrite/auth/route-helpers.server";

const schema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
  confirmPassword: z.string().min(1).max(256),
}).strict();

export async function POST(request: NextRequest) {
  return runAuthMutation(request, async () => {
    const parsed = schema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return { status: 400, body: { error: "Complete all password fields." } };
    return updateCurrentPassword(buildAuthCoreDeps(), await readSessionSecret(), parsed.data);
  });
}
