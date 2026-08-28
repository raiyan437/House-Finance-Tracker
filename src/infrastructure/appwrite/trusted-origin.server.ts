import "server-only";

import type { NextRequest } from "next/server";
import { loadAppwriteServerConfig } from "./config";

export class TrustedOriginConfigurationError extends Error {
  constructor() {
    super("Trusted application origin is unavailable.");
    this.name = "TrustedOriginConfigurationError";
  }
}

export function trustedApplicationOrigin(): string {
  const config = loadAppwriteServerConfig();
  if (!config.ok || !config.value) throw new TrustedOriginConfigurationError();
  return config.value.appOrigin;
}

/** Host and forwarding headers are deliberately irrelevant to this decision. */
export function requestHasTrustedOrigin(request: NextRequest, requireOrigin: boolean): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return !requireOrigin;
  try {
    return new URL(origin).origin === origin && origin === trustedApplicationOrigin();
  } catch {
    return false;
  }
}
