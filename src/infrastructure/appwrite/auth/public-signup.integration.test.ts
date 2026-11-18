import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as verify } from "@/app/api/auth/verification/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as restore } from "@/app/api/session/route";
import { GET as bootstrap } from "@/app/api/app/bootstrap/route";
import { GET as householdMembers } from "@/app/api/app/household-members/route";
import { InMemoryTablesReader } from "../reads/in-memory-tables-reader.helper";
import * as clients from "./clients.server";

const requestSession = vi.hoisted(() => ({ secret: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: requestSession.secret }) }) }));

const origin = "https://hft.test";

function post(path: string, body: unknown, requestOrigin = origin) {
  return new NextRequest(`${origin}${path}`, {
    method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  requestSession.secret = "";
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("connects public signup, verification, and login through the actual routes even when a household is full", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("HFT_APPWRITE_ENDPOINT", "https://provider.invalid/v1");
  vi.stubEnv("HFT_APPWRITE_PROJECT_ID", "test-project");
  vi.stubEnv("HFT_APPWRITE_RUNTIME_API_KEY", "fixture-runtime-key");
  vi.stubEnv("HFT_AUTH_HMAC_SECRET", "fixture-hmac-key");
  vi.stubEnv("HFT_APP_ORIGIN", origin);
  const user = { $id: "public-user", email: "outside@demo.test", status: true, emailVerification: false };
  const secret = "test-provider-session";
  const token = "test-verification-token";
  const storedRows = new Map<string, Record<string, unknown>>();
  const reader = new InMemoryTablesReader();
  const instant = "2026-11-17T00:00:00Z";
  const membership = { status: "active", joinedAt: instant, statusChangedAt: instant, version: 1 };
  const fullHouseholdMembers = Array.from({ length: 10 }, (_, index) => ({
    ...membership, $id: `other-member-${index}`, householdId: "other-household", userId: `existing-user-${index}`, role: index === 0 ? "leader" : "member",
  }));
  reader.seed("memberships", fullHouseholdMembers);
  reader.seed("join_requests", Array.from({ length: 10 }, (_, index) => ({
    $id: `other-request-${index}`, householdId: "other-household", userId: `waiting-user-${index}`, status: "pending", createdAt: instant,
  })));
  let sessionActive = false;
  const createVerification = vi.fn();
  const updateVerification = vi.fn(async () => { user.emailVerification = true; });
  const create = vi.fn(async () => user);
  vi.spyOn(clients, "createAppwriteAuthClients").mockReturnValue({
    publicAccount: () => ({ create }),
    adminAccount: () => ({
      createEmailPasswordSession: async () => {
        sessionActive = true;
        return { secret, expire: "2030-01-01T00:00:00Z" };
      },
    }),
    sessionAccount: (value: string) => ({
      get: async () => {
        if (!sessionActive || value !== secret) throw { code: 401, type: "user_unauthorized" };
        return user;
      },
      createEmailVerification: createVerification,
      updateEmailVerification: updateVerification,
      deleteSession: async () => { sessionActive = false; },
    }),
    tablesDB: () => ({
      getRow: async ({ rowId }: { rowId: string }) => {
        const row = storedRows.get(rowId);
        if (!row) throw { code: 404, type: "row_not_found" };
        return row;
      },
      createRow: async ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) => {
        if (storedRows.has(rowId)) throw { code: 409, type: "row_already_exists" };
        storedRows.set(rowId, { $id: rowId, ...data });
      },
      incrementRowColumn: async () => ({ counter: 2 }),
      listRows: async ({ tableId, queries }: { tableId: string; queries: string[] }) => {
        const rows = await reader.listRows(tableId, queries);
        return { total: rows.length, rows };
      },
    }),
    storage: () => ({}),
  } as unknown as clients.AppwriteAuthClients);

  const credentials = { email: user.email, password: "test-password" };
  const result = await signup(post("/api/auth/signup", { ...credentials, confirmPassword: credentials.password }));
  expect(result.status).toBe(201);
  expect(create).toHaveBeenCalledWith(expect.objectContaining(credentials));
  expect(createVerification).toHaveBeenCalledWith({ url: `${origin}/verify-email` });
  const cookie = result.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/^hft_session=test-provider-session; .*HttpOnly; SameSite=Lax; Secure$/);
  await expect(result.json()).resolves.toEqual({ status: "verification-required", verificationEmailSent: true });
  requestSession.secret = /^hft_session=([^;]+)/.exec(cookie)?.[1] ?? "";
  expect((await bootstrap(new NextRequest(`${origin}/api/app/bootstrap`))).status).toBe(403);
  expect(storedRows.has(user.$id)).toBe(false);

  const intent = { action: "confirm", userId: user.$id, secret: token };
  expect((await verify(post("/api/auth/verification", intent, "https://foreign.test"))).status).toBe(403);
  expect((await verify(post("/api/auth/verification", { ...intent, userId: "another-user" }))).status).toBe(400);
  expect(updateVerification).not.toHaveBeenCalled();
  expect((await verify(post("/api/auth/verification", intent))).status).toBe(200);
  expect(updateVerification).toHaveBeenCalledWith({ userId: user.$id, secret: token });
  const data = await bootstrap(new NextRequest(`${origin}/api/app/bootstrap`));
  expect(data.status).toBe(200);
  await expect(data.json()).resolves.toMatchObject({
    data: { session: { userId: user.$id, displayName: "Member" }, household: { status: "no-household" } },
  });
  const profile = storedRows.get(user.$id);
  expect(profile).toBeDefined();

  expect((await logout(post("/api/auth/logout", {}))).headers.get("set-cookie")).toContain("Max-Age=0");
  await expect((await restore(new NextRequest(`${origin}/api/session`))).json()).resolves.toEqual({ status: "anonymous" });
  await expect((await login(post("/api/auth/login", credentials))).json()).resolves.toMatchObject({ status: "authenticated" });
  expect(storedRows.get(user.$id)).toBe(profile);

  reader.seed("memberships", [
    ...fullHouseholdMembers,
    { ...membership, $id: "own-member", householdId: "own-household", userId: user.$id, role: "leader" },
  ]);
  const memberRequest = (id: string) => householdMembers(new NextRequest(`${origin}/api/app/household-members?householdId=${id}`));
  const own = await memberRequest("own-household");
  expect(own.status).toBe(200);
  await expect(own.json()).resolves.toEqual({ data: [{ userId: user.$id, displayName: "Member", status: "active", role: "leader" }] });
  const other = await memberRequest("other-household");
  expect(other.status).toBe(404);
  await expect(other.json()).resolves.toEqual({ code: "NOT_FOUND", error: "Not found." });
});
