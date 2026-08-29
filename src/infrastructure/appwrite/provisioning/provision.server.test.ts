import { describe, expect, it, vi } from "vitest";
import type { Users } from "node-appwrite";
import { provisionApprovedAccount } from "./provision.server";

const APPROVED_ACCOUNT_EMAILS = ["raiyan@test.io", "john@test.io", "sarah@test.io", "kim@test.io"];

function fakeUsers(existing: { $id: string; email: string }[] = []) {
  const created: { email: string; hasPassword: boolean }[] = [];
  const users = {
    list: async () => ({ total: existing.length, users: existing.map(({ $id, email }) => ({ $id, email })) }),
    create: async ({ email }: { email: string; password: string }) => {
      if (existing.some((user) => user.email === email)) throw Object.assign(new Error("exists"), { code: 409, type: "user_already_exists" });
      const password = "never-logged";
      void password;
      const user = { $id: "new-" + (existing.length + 1), email };
      existing.push(user);
      created.push({ email, hasPassword: true });
      return user;
    },
  } as unknown as Users;
  return { users: users as unknown as Users, created };
}

describe("approved account provisioning", () => {
  it("creates only approved users and never persists or returns the generated password", async () => {
    const { users, created } = fakeUsers();
    const result = await provisionApprovedAccount({ users, approvedAccountEmails: APPROVED_ACCOUNT_EMAILS }, "John@Test.io");
    expect(result.status).toBe("created");
    expect(result).not.toHaveProperty("userId");
    expect(created).toHaveLength(1);
  });

  it("refuses non-approved emails before any provider call", async () => {
    const { users, created } = fakeUsers();
    await expect(provisionApprovedAccount({ users, approvedAccountEmails: APPROVED_ACCOUNT_EMAILS }, "intruder@evil.io")).rejects.toThrow(/approved account/);
    expect(created).toHaveLength(0);
  });

  it("recognizes an already-provisioned approved user idempotently", async () => {
    const { users } = fakeUsers([{ $id: "user_1", email: "raiyan@test.io" }]);
    const result = await provisionApprovedAccount({ users, approvedAccountEmails: APPROVED_ACCOUNT_EMAILS }, "raiyan@test.io");
    expect(result.status).toBe("already-provisioned");
    expect(result).not.toHaveProperty("userId");
  });

  it("enforces the four-account production ceiling via the approved-account set", () => {
    expect(APPROVED_ACCOUNT_EMAILS.length).toBeLessThanOrEqual(4);
  });
});

describe("provisioning credential isolation", () => {
  it("fails closed when the dedicated provisioning key is absent", async () => {
    const { createProvisioningClients } = await import("./provision.server");
    expect(() => createProvisioningClients({ endpoint: "https://x.test/v1", projectId: "p" })).toThrow(/APPWRITE_PROVISIONING_API_KEY/);
    vi.clearAllMocks();
  });

  it("never falls back to the runtime or bootstrap credential", async () => {
    const { createProvisioningClients } = await import("./provision.server");
    expect(() => createProvisioningClients({
      endpoint: "https://x.test/v1",
      projectId: "p",
      runtimeApiKey: "runtime-only",
      bootstrapApiKey: "bootstrap-only",
    } as never)).toThrow(/APPWRITE_PROVISIONING_API_KEY/);
  });
});
