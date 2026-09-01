import type { NextRequest } from "next/server";
import { runAvatarRead, runAvatarReplace } from "@/infrastructure/appwrite/runtime/avatar-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runAvatarRead(request);
}

export async function POST(request: NextRequest) {
  return runAvatarReplace(request);
}
