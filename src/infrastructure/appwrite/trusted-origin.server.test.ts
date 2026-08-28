import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requestHasTrustedOrigin, trustedApplicationOrigin } from "./trusted-origin.server";

function configure(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("HFT_APPWRITE_ENDPOINT", "https://sgp.cloud.appwrite.io/v1");
  vi.stubEnv("HFT_APPWRITE_PROJECT_ID", "hft-prod");
  vi.stubEnv("HFT_APPWRITE_RUNTIME_API_KEY", "runtime-secret");
  vi.stubEnv("HFT_AUTH_HMAC_SECRET", "hmac-secret");
  vi.stubEnv("HFT_ALLOWED_ACCOUNT_EMAILS", "member@test.io");
  vi.stubEnv("HFT_APP_ORIGIN", "https://hft.appwrite.network");
}

afterEach(() => vi.unstubAllEnvs());

describe("trusted Appwrite Sites origin", () => {
  it("ignores poisoned Host and forwarding headers when the configured Origin is trusted", () => {
    configure();
    const request = new NextRequest("https://attacker.test/api/app/cards", {
      method: "POST",
      headers: {
        origin: "https://hft.appwrite.network",
        host: "attacker.test",
        "x-forwarded-host": "attacker.test",
      },
    });
    expect(requestHasTrustedOrigin(request, true)).toBe(true);
    expect(trustedApplicationOrigin()).toBe("https://hft.appwrite.network");
  });

  it("rejects a malicious Origin even when Host and X-Forwarded-Host claim the Site", () => {
    configure();
    const request = new NextRequest("https://hft.appwrite.network/api/app/cards", {
      method: "POST",
      headers: {
        origin: "https://attacker.test",
        host: "hft.appwrite.network",
        "x-forwarded-host": "hft.appwrite.network",
      },
    });
    expect(requestHasTrustedOrigin(request, true)).toBe(false);
  });

  it("requires Origin on mutations and permits its absence only on read-style requests", () => {
    configure();
    const request = new NextRequest("https://hft.appwrite.network/api/session");
    expect(requestHasTrustedOrigin(request, true)).toBe(false);
    expect(requestHasTrustedOrigin(request, false)).toBe(true);
  });
});
