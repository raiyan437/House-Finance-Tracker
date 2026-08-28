import { Account, Client, Storage, TablesDB } from "node-appwrite";
import { loadAppwriteServerConfig, type AppwriteServerConfig } from "../config";

type AppwriteClientConfig = Pick<AppwriteServerConfig, "endpoint" | "projectId" | "runtimeApiKey">;

export interface AppwriteAuthClients {
  readonly adminAccount: () => Account;
  readonly sessionAccount: (sessionSecret: string) => Account;
  readonly tablesDB: () => TablesDB;
  readonly storage: () => Storage;
}

function baseClient(config: AppwriteClientConfig): Client {
  return new Client().setEndpoint(config.endpoint).setProject(config.projectId);
}

export function createAppwriteAuthClients(config: AppwriteClientConfig = requireLoadedConfig()): AppwriteAuthClients {
  return {
    adminAccount: () => new Account(baseClient(config).setKey(runtimeKey(config))),
    sessionAccount: (sessionSecret: string) => new Account(baseClient(config).setSession(sessionSecret)),
    tablesDB: () => new TablesDB(baseClient(config).setKey(runtimeKey(config))),
    storage: () => new Storage(baseClient(config).setKey(runtimeKey(config))),
  };
}

function runtimeKey(config: AppwriteClientConfig): string {
  return config.runtimeApiKey;
}

function requireLoadedConfig(): AppwriteServerConfig {
  const result = loadAppwriteServerConfig();
  if (!result.ok || !result.value) throw new Error("Appwrite configuration is invalid: " + (result.errors ?? []).join(" "));
  return result.value;
}
