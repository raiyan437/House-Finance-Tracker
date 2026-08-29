import { randomBytes } from "node:crypto";
import { Client, ID, Users } from "node-appwrite";
import { AuthError } from "../auth/auth-errors.server";

export const MAX_PRODUCTION_USERS = 4;

export interface ProvisioningDeps {
  readonly users: Users;
  readonly approvedAccountEmails: readonly string[];
}

export interface ProvisioningClients {
  readonly users: Users;
}

export function createProvisioningClients(config: Readonly<{ endpoint: string; projectId: string; provisioningApiKey?: string }>): ProvisioningClients {
  if (!config.provisioningApiKey) {
    throw new AuthError("PROVIDER_UNAVAILABLE", "APPWRITE_PROVISIONING_API_KEY is required for account provisioning.");
  }
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(config.provisioningApiKey);
  return { users: new Users(client) };
}

export function normalizeProvisioningEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("INVALID_INPUT", "A valid email is required.");
  return email;
}

function secureRandomPassword(): string {
  return `${randomBytes(24).toString("base64url")}1aA`;
}

export type ProvisioningStatus = "created" | "already-provisioned";

export interface ProvisioningResult {
  readonly status: ProvisioningStatus;
}

export async function provisionApprovedAccount(deps: ProvisioningDeps, rawEmail: string): Promise<ProvisioningResult> {
  const email = normalizeProvisioningEmail(rawEmail);
  if (!deps.approvedAccountEmails.includes(email)) {
    throw new AuthError("EMAIL_NOT_PERMITTED", "That email address is not an approved account.");
  }
  const existing = await deps.users.list({ queries: [] });
  const match = existing.users.find((user) => user.email.toLowerCase() === email);
  if (match) return { status: "already-provisioned" };
  const provisionedApproved = existing.users.filter((user) => deps.approvedAccountEmails.includes(user.email.toLowerCase()));
  if (provisionedApproved.length + 1 > MAX_PRODUCTION_USERS) {
    throw new AuthError("EMAIL_NOT_PERMITTED", "The maximum number of provisioned accounts has been reached.");
  }
  await deps.users.create({
    userId: ID.unique(),
    email,
    password: secureRandomPassword(),
  });
  return { status: "created" };
}
