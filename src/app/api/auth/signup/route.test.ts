import { NextResponse, type NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signup: vi.fn(), deps: {} }));

vi.mock("@/infrastructure/appwrite/auth/account-service.server", () => ({ signupWithPassword: mocks.signup }));
vi.mock("@/infrastructure/appwrite/auth/deps.server", () => ({ buildAuthCoreDeps: () => mocks.deps }));
vi.mock("@/infrastructure/appwrite/auth/route-helpers.server", () => ({
  runAuthMutation: async (_request: NextRequest, handler: () => Promise<{ status: number; body: Record<string, unknown> }>) => {
    const result = await handler();
    return NextResponse.json(result.body, { status: result.status });
  },
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new Request("https://hft.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.9" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("signup route input boundary", () => {
  it("rejects forged identity fields structurally", async () => {
    mocks.signup.mockReset();
    const response = await POST(request({
      email: "raiyan@test.io", password: "new-password", confirmPassword: "new-password", userId: "forged-user",
    }));
    expect(response.status).toBe(400);
    expect(mocks.signup).not.toHaveBeenCalled();
  });

  it("passes only validated signup intent and the request IP", async () => {
    mocks.signup.mockReset();
    mocks.signup.mockResolvedValue({ status: 201, body: { status: "authenticated" } });
    const input = { email: "raiyan@test.io", password: "new-password", confirmPassword: "new-password" };
    const response = await POST(request(input));
    expect(response.status).toBe(201);
    expect(mocks.signup).toHaveBeenCalledWith(mocks.deps, ["198.51.100.9"], input);
  });
});
