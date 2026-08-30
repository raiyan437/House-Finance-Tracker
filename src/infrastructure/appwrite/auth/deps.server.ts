import { AuthError } from "./auth-errors.server";
import { loadAppwriteServerConfig } from "../config";
import { createAppwriteAuthClients } from "./clients.server";
import type { AuthCoreDeps } from "./account-service.server";

export function buildAuthCoreDeps(): AuthCoreDeps {
  const config = loadAppwriteServerConfig();
  if (!config.ok || !config.value) {
    throw new AuthError("PROVIDER_UNAVAILABLE", "The authentication service is temporarily unavailable.");
  }
  const clients = createAppwriteAuthClients(config.value);
  return {
    publicAccount: clients.publicAccount,
    adminAccount: clients.adminAccount,
    sessionAccount: clients.sessionAccount,
    tablesDB: clients.tablesDB(),
    accountEmails: config.value.accountEmails,
    authSecret: config.value.authSecret,
    origin: config.value.appOrigin,
  };
}
