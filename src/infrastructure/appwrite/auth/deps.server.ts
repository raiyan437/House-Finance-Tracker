import { AuthError } from "./auth-errors.server";
import { loadAppwriteServerConfig } from "../config";
import { createAppwriteAuthClients } from "./clients.server";
import type { AuthCoreDeps } from "./account-service.server";

export function buildAuthCoreDeps(origin: string): AuthCoreDeps {
  const config = loadAppwriteServerConfig();
  if (!config.ok || !config.value) {
    throw new AuthError("PROVIDER_UNAVAILABLE", "The authentication service is temporarily unavailable.");
  }
  const clients = createAppwriteAuthClients(config.value);
  const authSecret = process.env.AUTH_HMAC_SECRET;
  if (!authSecret) {
    throw new AuthError("PROVIDER_UNAVAILABLE", "The authentication service is temporarily unavailable.");
  }
  return {
    adminAccount: clients.adminAccount,
    sessionAccount: clients.sessionAccount,
    tablesDB: clients.tablesDB(),
    accountEmails: config.value.accountEmails,
    authSecret,
    origin,
  };
}
