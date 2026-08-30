import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

const routeMocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  resolveTrustedActor: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: routeMocks.cookies }));
vi.mock("./context.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context.server")>()),
  resolveTrustedActor: routeMocks.resolveTrustedActor,
}));

import { resolveReadContext, runTrustedCommand } from "./read-route.server";

describe("production read session envelope", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HFT_APPWRITE_ENDPOINT", "https://appwrite.test/v1");
    vi.stubEnv("HFT_APPWRITE_PROJECT_ID", "hft-test");
    vi.stubEnv("HFT_APPWRITE_RUNTIME_API_KEY", "runtime-test-key");
    vi.stubEnv("HFT_AUTH_HMAC_SECRET", "test-secret");
    vi.stubEnv("HFT_APP_ORIGIN", "https://hft.test");
    routeMocks.cookies.mockResolvedValue({ get: () => ({ value: "revoked-session" }) });
    routeMocks.resolveTrustedActor.mockResolvedValue({ status: "anonymous" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("clears a presented cookie when Appwrite resolves the session as anonymous", async () => {
    const result = await resolveReadContext();
    expect(result.status).not.toBe("ok");
    if (result.status === "ok") throw new Error("Expected an anonymous response.");
    expect(result.status.status).toBe(401);
    expect(result.status.headers.get("set-cookie")).toBe(
      "hft_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
    );
  });

  it("rejects an anonymous authenticated command before invoking its handler", async () => {
    const handler = vi.fn();
    const response = await runTrustedCommand(
      new NextRequest("https://hft.test/api/app/profile-display-name", {
        method: "POST",
        headers: { origin: "https://hft.test", "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Raiyan", expectedVersion: 1, commandId: "profile-command" }),
      }),
      z.object({ displayName: z.string(), expectedVersion: z.number(), commandId: z.string() }).strict(),
      handler,
    );
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});
