import { Account, Client, Storage, TablesDB } from "node-appwrite";
import { loadAppwriteServerConfig, type AppwriteServerConfig } from "../config";

export interface AppwriteAuthClients {
  readonly adminAccount: () => Account;
  readonly sessionAccount: (sessionSecret: string) => Account;
  readonly tablesDB: () => TablesDB;
  readonly storage: () => Storage;
}

function baseClient(config: AppwriteServerConfig): Client {
  return new Client().setEndpoint(config.endpoint).setProject(config.projectId);
}

export function createAppwriteAuthClients(config: AppwriteServerConfig = requireLoadedConfig()): AppwriteAuthClients {
  return {
    adminAccount: () => new Account(baseClient(config).setKey(runtimeKey(config))),
    sessionAccount: (sessionSecret: string) => new Account(baseClient(config).setSession(sessionSecret)),
    tablesDB: () => new TablesDB(baseClient(config).setKey(runtimeKey(config))),
    storage: () => new Storage(baseClient(config).setKey(runtimeKey(config))),
  };
}

function runtimeKey(config: AppwriteServerConfig): string {
  if (!config.runtimeApiKey) throw new Error("APPWRITE_RUNTIME_API_KEY is required for authentication operations.");
  return config.runtimeApiKey;
}

function requireLoadedConfig(): AppwriteServerConfig {
  const result = loadAppwriteServerConfig();
  if (!result.ok || !result.value) throw new Error("Appwrite configuration is invalid: " + (result.errors ?? []).join(" "));
  return result.value;
}
