import { NextResponse, type NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ update: vi.fn(), deps: {}, secret: "trusted-session" }));

vi.mock("@/infrastructure/appwrite/auth/account-service.server", () => ({ updateCurrentPassword: mocks.update }));
vi.mock("@/infrastructure/appwrite/auth/deps.server", () => ({ buildAuthCoreDeps: () => mocks.deps }));
vi.mock("@/infrastructure/appwrite/auth/route-helpers.server", () => ({
  readSessionSecret: async () => mocks.secret,
  runAuthMutation: async (_request: NextRequest, handler: () => Promise<{ status: number; body: Record<string, unknown> }>) => {
    const result = await handler();
    return NextResponse.json(result.body, { status: result.status });
  },
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new Request("https://hft.test/api/auth/password", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as NextRequest;
}

describe("password route input boundary", () => {
  it("rejects forged actor and session fields structurally", async () => {
    mocks.update.mockReset();
    const response = await POST(request({
      currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password", userId: "forged", sessionId: "forged",
    }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("derives the session independently of the validated password intent", async () => {
    mocks.update.mockReset();
    mocks.update.mockResolvedValue({ status: 200, body: { updated: true } });
    const input = { currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" };
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(mocks.deps, mocks.secret, input);
  });
});
