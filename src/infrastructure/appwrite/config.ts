import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_APPROVED_ACCOUNT_EMAILS = 4;

export type AccountEmailConfiguration =
  | Readonly<{ status: "enabled"; emails: readonly string[] }>
  | Readonly<{ status: "disabled"; reason: "missing" | "empty" | "invalid_format" | "too_many_entries" }>;

export interface AppwriteServerConfig {
  readonly endpoint: string;
  readonly projectId: string;
  readonly runtimeApiKey?: string;
  readonly bootstrapApiKey?: string;
  readonly accountEmails: AccountEmailConfiguration;
}

export interface AppwriteServerConfigResult {
  readonly ok: boolean;
  readonly value?: AppwriteServerConfig;
  readonly errors?: readonly string[];
  readonly accountEmailsDisabledReason?: Exclude<AccountEmailConfiguration, { status: "enabled" }>["reason"];
}

export interface AppwriteProvisioningConfig {
  readonly endpoint: string;
  readonly projectId: string;
  readonly provisioningApiKey: string;
  readonly accountEmails: AccountEmailConfiguration;
}

export interface AppwriteProvisioningConfigResult {
  readonly ok: boolean;
  readonly value?: AppwriteProvisioningConfig;
  readonly errors?: readonly string[];
  readonly accountEmailsDisabledReason?: Exclude<AccountEmailConfiguration, { status: "enabled" }>["reason"];
}

function normalizeAccountEmails(raw: string | undefined): AccountEmailConfiguration {
  if (raw === undefined || raw.trim() === "") return { status: "disabled", reason: raw === undefined ? "missing" : "empty" };
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 254) return { status: "disabled", reason: "invalid_format" };
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }
  if (emails.length === 0) return { status: "disabled", reason: "empty" };
  if (emails.length > MAX_APPROVED_ACCOUNT_EMAILS) return { status: "disabled", reason: "too_many_entries" };
  return { status: "enabled", emails };
}

export function validateAccountEmails(raw: string | undefined): AccountEmailConfiguration {
  return normalizeAccountEmails(raw);
}

const endpointSchema = z.string().url();

export function mergeDotEnvFile(path: string, target: Record<string, string | undefined> = process.env): number {
  if (!existsSync(path)) return 0;
  let merged = 0;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (target[key] === undefined) {
      target[key] = value;
      merged += 1;
    }
  }
  return merged;
}

export function loadAppwriteServerConfig(env: Record<string, string | undefined> = process.env): AppwriteServerConfigResult {
  const errors: string[] = [];
  const endpoint = env.APPWRITE_ENDPOINT;
  const projectId = env.APPWRITE_PROJECT_ID;
  if (!endpoint) errors.push("APPWRITE_ENDPOINT is required.");
  else if (!endpointSchema.safeParse(endpoint).success) errors.push("APPWRITE_ENDPOINT must be a valid HTTPS URL.");
  if (!projectId) errors.push("APPWRITE_PROJECT_ID is required.");
  else if (!/^[a-zA-Z0-9._-]{1,36}$/.test(projectId)) errors.push("APPWRITE_PROJECT_ID has an invalid format.");
  const accountEmails = normalizeAccountEmails(env.ALLOWED_ACCOUNT_EMAILS);
  if (errors.length > 0) return { ok: false, errors, accountEmailsDisabledReason: accountEmails.status === "disabled" ? accountEmails.reason : undefined };
  return {
    ok: true,
    value: {
      endpoint: endpoint as string,
      projectId: projectId as string,
      runtimeApiKey: env.APPWRITE_RUNTIME_API_KEY,
      bootstrapApiKey: env.APPWRITE_BOOTSTRAP_API_KEY,
      accountEmails,
    },
  };
}

export function loadAppwriteProvisioningConfig(
  env: Record<string, string | undefined> = process.env,
): AppwriteProvisioningConfigResult {
  const server = loadAppwriteServerConfig(env);
  const provisioningApiKey = env.APPWRITE_PROVISIONING_API_KEY;
  const errors = [...(server.errors ?? [])];
  if (!provisioningApiKey) errors.push("APPWRITE_PROVISIONING_API_KEY is required for account provisioning.");
  if (!server.ok || !server.value || errors.length > 0) {
    return {
      ok: false,
      errors,
      accountEmailsDisabledReason: server.accountEmailsDisabledReason,
    };
  }
  return {
    ok: true,
    value: {
      endpoint: server.value.endpoint,
      projectId: server.value.projectId,
      provisioningApiKey: provisioningApiKey as string,
      accountEmails: server.value.accountEmails,
    },
  };
}
