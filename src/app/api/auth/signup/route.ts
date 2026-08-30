import { z } from "zod";
import type { NextRequest } from "next/server";
import { signupWithPassword } from "@/infrastructure/appwrite/auth/account-service.server";
import { buildAuthCoreDeps } from "@/infrastructure/appwrite/auth/deps.server";
import { runAuthMutation } from "@/infrastructure/appwrite/auth/route-helpers.server";

const schema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(256),
  confirmPassword: z.string().min(1).max(256),
}).strict();

export async function POST(request: NextRequest) {
  return runAuthMutation(request, async () => {
    const parsed = schema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return { status: 400, body: { error: "Email, password, and password confirmation are required." } };
    const deps = buildAuthCoreDeps();
    const ipAddress = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    return signupWithPassword(deps, [ipAddress], parsed.data);
  });
}
