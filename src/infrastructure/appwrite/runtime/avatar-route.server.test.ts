import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({ resolveReadContext: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./read-route.server", () => ({
  assertSameOrigin: (request: NextRequest) => request.headers.get("origin") !== "https://evil.test",
  mapReadError: (error: unknown) => {
    const value = error as { code?: string; message?: string };
    return value.code ? { status: value.code === "NOT_FOUND" ? 404 : value.code === "PROFILE_VERSION_CONFLICT" ? 409 : 400, body: { error: value.message, code: value.code } } : undefined;
  },
  resolveReadContext: routeMocks.resolveReadContext,
}));

import { runAvatarRead, runAvatarReplace } from "./avatar-route.server";

function uploadRequest(bytes: Uint8Array, origin = "https://hft.test") {
  return new NextRequest("https://hft.test/api/app/profile-avatar", {
    method: "POST",
    headers: {
      origin,
      "content-length": String(bytes.byteLength),
      "content-type": "image/png",
      "x-command-id": "avatar-command",
      "x-profile-version": "3",
    },
    body: bytes.slice().buffer as ArrayBuffer,
  });
}

describe("trusted Profile avatar route", () => {
  beforeEach(() => routeMocks.resolveReadContext.mockReset());

  it("denies cross-origin reads and uploads before resolving identity", async () => {
    expect((await runAvatarRead(new NextRequest("https://hft.test/api/app/profile-avatar?userId=u_owner", { headers: { origin: "https://evil.test" } }))).status).toBe(403);
    expect((await runAvatarReplace(uploadRequest(new Uint8Array([1]), "https://evil.test"))).status).toBe(403);
    expect(routeMocks.resolveReadContext).not.toHaveBeenCalled();
  });

  it("authenticates and capability-checks before reading an upload body", async () => {
    routeMocks.resolveReadContext.mockResolvedValue({ status: new NextResponse(null, { status: 401 }) });
    expect((await runAvatarReplace(uploadRequest(new Uint8Array([1])))).status).toBe(401);

    const replace = vi.fn();
    routeMocks.resolveReadContext.mockResolvedValue({ status: "ok", context: { capabilities: { avatarMutations: false }, avatarOperations: { replace } } });
    expect((await runAvatarReplace(uploadRequest(new Uint8Array([1])))).status).toBe(404);
    expect(replace).not.toHaveBeenCalled();
  });

  it("passes only the session-derived operation its bounded content and returns no Storage identity", async () => {
    const replace = vi.fn().mockResolvedValue({ profileVersion: 4, avatarUpdatedAt: "2026-09-01T00:00:00.000Z" });
    routeMocks.resolveReadContext.mockResolvedValue({ status: "ok", context: { capabilities: { avatarMutations: true }, avatarOperations: { replace } } });
    const response = await runAvatarReplace(uploadRequest(new Uint8Array([1, 2, 3])));
    expect(response.status).toBe(200);
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ commandId: "avatar-command", expectedProfileVersion: 3, bytes: new Uint8Array([1, 2, 3]) }));
    const payload = await response.text();
    expect(payload).not.toMatch(/avatarFileId|storage|bucket|filename|checksum/i);
  });

  it("reads by application user ID with private no-store and nosniff headers", async () => {
    const read = vi.fn().mockResolvedValue({ bytes: new Uint8Array([4, 5]), mimeType: "image/webp", sizeBytes: 2 });
    routeMocks.resolveReadContext.mockResolvedValue({ status: "ok", context: { capabilities: { avatarContentReads: true }, avatarOperations: { read } } });
    const response = await runAvatarRead(new NextRequest("https://hft.test/api/app/profile-avatar?userId=u_member"));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith("u_member");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("image/webp");
  });

  it("privacy-collapses guessed identities and sanitizes unexpected provider failures", async () => {
    const notFound = Object.assign(new Error("Profile picture not found."), { code: "NOT_FOUND" });
    routeMocks.resolveReadContext.mockResolvedValueOnce({ status: "ok", context: { capabilities: { avatarContentReads: true }, avatarOperations: { read: vi.fn().mockRejectedValue(notFound) } } });
    expect((await runAvatarRead(new NextRequest("https://hft.test/api/app/profile-avatar?userId=u_guessed"))).status).toBe(404);

    routeMocks.resolveReadContext.mockResolvedValueOnce({ status: "ok", context: { capabilities: { avatarContentReads: true }, avatarOperations: { read: vi.fn().mockRejectedValue(new Error("provider secret detail")) } } });
    const response = await runAvatarRead(new NextRequest("https://hft.test/api/app/profile-avatar?userId=u_member"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("provider secret detail");
  });
});
