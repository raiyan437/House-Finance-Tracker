import type { NextRequest } from "next/server";
import { buildAuthCoreDeps } from "@/infrastructure/appwrite/auth/deps.server";
import { restoreSessionState } from "@/infrastructure/appwrite/auth/account-service.server";
import { readSessionSecret, runAuthMutation } from "@/infrastructure/appwrite/auth/route-helpers.server";

export async function GET(request: NextRequest) {
  return runAuthMutation(request, async () => {
    const deps = buildAuthCoreDeps();
    return restoreSessionState(deps, await readSessionSecret());
  });
}
