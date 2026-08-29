import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  resolveTrustedActor: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: routeMocks.cookies }));
vi.mock("./context.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context.server")>()),
  resolveTrustedActor: routeMocks.resolveTrustedActor,
}));

import { resolveReadContext } from "./read-route.server";

describe("production read session envelope", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
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
});
