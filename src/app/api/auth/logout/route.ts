import { NextResponse, type NextRequest } from "next/server";
import { buildAuthCoreDeps } from "@/infrastructure/appwrite/auth/deps.server";
import { logoutCurrentSession } from "@/infrastructure/appwrite/auth/account-service.server";
import { readSessionSecret, runAuthMutation } from "@/infrastructure/appwrite/auth/route-helpers.server";

export async function POST(request: NextRequest) {
  return runAuthMutation(request, async () => {
    const deps = buildAuthCoreDeps(new URL(request.url).origin);
    return logoutCurrentSession(deps, await readSessionSecret());
  });
}

export function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}
