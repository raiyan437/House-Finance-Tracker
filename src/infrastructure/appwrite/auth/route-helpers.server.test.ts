import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { runAuthMutation } from "./route-helpers.server";
import { SESSION_COOKIE_NAME } from "./session-cookie";

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

describe("production auth route envelope", () => {
  it("sets a host-only HttpOnly Secure SameSite=Lax cookie with Appwrite expiry", async () => {
    configure();
    const expire = "2027-01-01T00:00:00.000Z";
    const response = await runAuthMutation(
      new NextRequest("https://poisoned-host.test/api/auth/login", {
        method: "POST",
        headers: { origin: "https://hft.appwrite.network", host: "poisoned-host.test", "x-forwarded-host": "poisoned-host.test" },
      }),
      async () => ({ status: 200, body: { ok: true }, cookie: { action: "set", secret: "session-secret", expire } }),
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=session-secret`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Expires=${new Date(expire).toUTCString()}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toMatch(/(?:^|;\s*)Domain=/i);
  });

  it("rejects missing and foreign mutation Origins before invoking the handler", async () => {
    configure();
    let calls = 0;
    const cases: HeadersInit[] = [new Headers(), { origin: "https://attacker.test", host: "hft.appwrite.network" }];
    for (const headers of cases) {
      const response = await runAuthMutation(
        new NextRequest("https://hft.appwrite.network/api/auth/login", { method: "POST", headers }),
        async () => { calls += 1; return { status: 200, body: {} }; },
      );
      expect(response.status).toBe(403);
    }
    expect(calls).toBe(0);
  });

  it("clears a revoked session with the same host-only hardened attributes", async () => {
    configure();
    const response = await runAuthMutation(
      new NextRequest("https://hft.appwrite.network/api/session"),
      async () => ({ status: 200, body: { status: "anonymous" }, cookie: { action: "clear" } }),
    );
    expect(response.headers.get("set-cookie")).toBe(
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    );
  });
});
