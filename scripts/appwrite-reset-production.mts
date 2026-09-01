/**
 * Operator-only production test-data reset.
 *
 * Dry run:
 *   npm run appwrite:reset-production
 *
 * Execute only after a verified external backup:
 *   npm run appwrite:reset-production -- --yes \
 *     --confirm "DELETE ALL TEST DATA FOR FRESH START" \
 *     --backup <external-backup-directory>
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { Client, Functions, Query, Storage, TablesDB, Users } from "node-appwrite";
import { validateAccountEmails } from "../src/infrastructure/appwrite/config";
import {
  EXPECTED_SCHEMA_VERSION,
  PRODUCTION_ORIGIN,
  RESET_TABLE_ORDER,
  assertBackupCoversInventory,
  assertExpectedProductionTarget,
  classifyAuthUsers,
  deleteProductionTestData,
  parseResetArguments,
  type AuthUserLike,
  type ResetOperations,
  type ResetTableId,
} from "./appwrite-reset-production-core";

const DATABASE_ID = "hft";
const BUCKET_ID = "receipts";
const FUNCTION_ID = "maintenance";
const EXPECTED_MAINTENANCE_SCHEDULE = "0 0 * * *";
const ENV_FILE = ".env.local";

interface ProductionResetEnv {
  readonly endpoint: string;
  readonly projectId: string;
  readonly runtimeApiKey: string;
  readonly bootstrapApiKey: string;
  readonly provisioningApiKey: string;
  readonly approvedEmails: ReadonlySet<string>;
}

interface Inventory {
  readonly endpointHost: string;
  readonly projectId: string;
  readonly databaseId: string;
  readonly productionOrigin: string;
  readonly schemaVersion: number;
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly storageFileCount: number;
  readonly authUserCount: number;
  readonly authUsers: ReturnType<typeof classifyAuthUsers>;
  readonly authClassificationCounts: Readonly<Record<string, number>>;
  readonly executionBlocked: boolean;
}

interface BackupManifestSummary {
  readonly projectId: string;
  readonly tableCounts: Readonly<Record<string, number>>;
  readonly receipts: readonly unknown[];
}

function parseEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/u).flatMap((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    return match ? [[match[1], match[2]]] : [];
  }));
}

function loadProductionResetEnv(): ProductionResetEnv {
  const values = parseEnvFile(ENV_FILE);
  const endpoint = values.APPWRITE_ENDPOINT;
  const projectId = values.APPWRITE_PROJECT_ID;
  const runtimeApiKey = values.APPWRITE_RUNTIME_API_KEY;
  const bootstrapApiKey = values.APPWRITE_BOOTSTRAP_API_KEY;
  const provisioningApiKey = values.APPWRITE_PROVISIONING_API_KEY;
  if (!endpoint || !projectId || !runtimeApiKey || !bootstrapApiKey || !provisioningApiKey) {
    throw new Error("Production reset requires endpoint, project, runtime, bootstrap, and provisioning operator configuration in .env.local.");
  }
  const allowlist = validateAccountEmails(values.ALLOWED_ACCOUNT_EMAILS);
  if (allowlist.status !== "enabled") throw new Error("Production reset refused: approved-email allowlist is unavailable or invalid.");
  return { endpoint, projectId, runtimeApiKey, bootstrapApiKey, provisioningApiKey, approvedEmails: new Set(allowlist.emails) };
}

function client(env: ProductionResetEnv, key: string): Client {
  return new Client().setEndpoint(env.endpoint).setProject(env.projectId).setKey(key);
}

async function listAllUsers(users: Users): Promise<readonly AuthUserLike[]> {
  const result: AuthUserLike[] = [];
  let cursor: string | undefined;
  for (;;) {
    const queries = [Query.orderAsc("$id"), Query.limit(100)];
    const page = await users.list({ queries: cursor ? [...queries, Query.cursorAfter(cursor)] : queries, total: false });
    result.push(...page.users.map((user) => ({ $id: user.$id, email: user.email })));
    if (page.users.length < 100) return result;
    cursor = page.users.at(-1)?.$id;
  }
}

async function rowCount(tables: TablesDB, tableId: string): Promise<number> {
  return (await tables.listRows({ databaseId: DATABASE_ID, tableId, queries: [Query.limit(1)] })).total;
}

async function buildInventory(input: {
  env: ProductionResetEnv;
  tables: TablesDB;
  storage: Storage;
  users: Users;
}): Promise<Inventory> {
  const tableIds = [...RESET_TABLE_ORDER, "schema_metadata"];
  const [schema, files, authUsers, ...counts] = await Promise.all([
    input.tables.getRow({ databaseId: DATABASE_ID, tableId: "schema_metadata", rowId: "active" }),
    input.storage.listFiles({ bucketId: BUCKET_ID, queries: [Query.limit(1)] }),
    listAllUsers(input.users),
    ...tableIds.map((tableId) => rowCount(input.tables, tableId)),
  ]);
  assertExpectedProductionTarget({
    endpoint: input.env.endpoint,
    projectId: input.env.projectId,
    schemaVersion: Number(schema.version),
    approvedEmailCount: input.env.approvedEmails.size,
  });
  const classified = classifyAuthUsers(authUsers, input.env.approvedEmails);
  const authClassificationCounts = Object.fromEntries([
    "approved-email-test-user",
    "anonymous-test-artifact",
    "unexpected-user",
  ].map((classification) => [classification, classified.filter((user) => user.classification === classification).length]));
  return {
    endpointHost: new URL(input.env.endpoint).host,
    projectId: input.env.projectId,
    databaseId: DATABASE_ID,
    productionOrigin: PRODUCTION_ORIGIN,
    schemaVersion: Number(schema.version),
    rowCounts: Object.fromEntries(tableIds.map((tableId, index) => [tableId, counts[index]])),
    storageFileCount: files.total,
    authUserCount: authUsers.length,
    authUsers: classified,
    authClassificationCounts,
    executionBlocked: authClassificationCounts["unexpected-user"] > 0,
  };
}

function assertExternalBackupPath(directory: string): string {
  const root = resolve(directory);
  const workspace = resolve(".");
  const fromWorkspace = relative(workspace, root);
  if (fromWorkspace === "" || (!fromWorkspace.startsWith("..") && !isAbsolute(fromWorkspace))) {
    throw new Error("Production reset refused: backup must be outside the repository.");
  }
  return root;
}

function verifyBackupForInventory(directory: string, inventory: Inventory): string {
  const root = assertExternalBackupPath(directory);
  const verification = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/appwrite-backup.mts"), "--verify", root], {
    cwd: resolve("."),
    encoding: "utf8",
    windowsHide: true,
  });
  if (verification.status !== 0) throw new Error("Production reset refused: external backup verification failed.");
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as BackupManifestSummary;
  if (manifest.projectId !== inventory.projectId) throw new Error("Production reset refused: backup project does not match production.");
  assertBackupCoversInventory(
    manifest.tableCounts,
    manifest.receipts.length,
    inventory.rowCounts,
    inventory.storageFileCount,
  );
  return root;
}

function isNotFound(error: unknown): boolean {
  return Number((error as { code?: unknown }).code) === 404;
}

function resetOperations(tables: TablesDB, storage: Storage, users: Users): ResetOperations {
  return {
    async listStorageFileIds() {
      return (await storage.listFiles({ bucketId: BUCKET_ID, queries: [Query.orderAsc("$id"), Query.limit(100)], total: false })).files.map((file) => file.$id);
    },
    async deleteStorageFile(fileId) {
      try {
        await storage.deleteFile({ bucketId: BUCKET_ID, fileId });
        return "deleted";
      } catch (error) {
        if (isNotFound(error)) return "already-missing";
        throw error;
      }
    },
    async listRowIds(tableId: ResetTableId) {
      return (await tables.listRows({ databaseId: DATABASE_ID, tableId, queries: [Query.orderAsc("$id"), Query.limit(100)], total: false })).rows.map((row) => row.$id);
    },
    async deleteRow(tableId, rowId) {
      try {
        await tables.deleteRow({ databaseId: DATABASE_ID, tableId, rowId });
        return "deleted";
      } catch (error) {
        if (isNotFound(error)) return "already-missing";
        throw error;
      }
    },
    async listAuthUserIds() {
      return (await users.list({ queries: [Query.orderAsc("$id"), Query.limit(100)], total: false })).users.map((user) => user.$id);
    },
    async deleteAuthUser(userId) {
      try {
        await users.delete({ userId });
        return "deleted";
      } catch (error) {
        if (isNotFound(error)) return "already-missing";
        throw error;
      }
    },
  };
}

function operationStage(error: unknown, stage: string): Error {
  const providerCode = Number((error as { code?: unknown }).code);
  const suffix = Number.isFinite(providerCode) && providerCode > 0 ? ` (provider ${providerCode})` : "";
  return new Error(`Production reset stopped during ${stage}${suffix}.`, { cause: error });
}

async function main(): Promise<void> {
  const args = parseResetArguments(process.argv.slice(2));
  const env = loadProductionResetEnv();
  const runtimeClient = client(env, env.runtimeApiKey);
  const bootstrapClient = client(env, env.bootstrapApiKey);
  const provisioningClient = client(env, env.provisioningApiKey);
  const tables = new TablesDB(runtimeClient);
  const storage = new Storage(runtimeClient);
  const users = new Users(provisioningClient);
  const functions = new Functions(bootstrapClient);
  const inventory = await buildInventory({ env, tables, storage, users });
  console.log(JSON.stringify({ mode: args.execute ? "execution-preflight" : "dry-run", target: inventory }, null, 2));
  if (!args.execute) return;
  if (inventory.executionBlocked) throw new Error("Production reset stopped: unexpected Auth identity classification requires owner review.");
  const backupDirectory = verifyBackupForInventory(args.backupDirectory as string, inventory);

  const maintenance = await functions.get({ functionId: FUNCTION_ID });
  if (!maintenance.enabled || maintenance.schedule !== EXPECTED_MAINTENANCE_SCHEDULE || maintenance.execute.length !== 0 || !maintenance.deploymentId) {
    throw new Error("Production reset refused: maintenance Function does not match the approved active configuration.");
  }
  const deployment = await functions.getDeployment({ functionId: FUNCTION_ID, deploymentId: maintenance.deploymentId });
  if (deployment.status !== "ready") throw new Error("Production reset refused: maintenance deployment is not Ready.");

  let maintenancePaused = false;
  let deletionResult: Awaited<ReturnType<typeof deleteProductionTestData>> | undefined;
  let resetError: unknown;
  try {
    await functions.update({ functionId: FUNCTION_ID, name: maintenance.name, schedule: "" });
    const paused = await functions.get({ functionId: FUNCTION_ID });
    if (paused.schedule !== "" || paused.deploymentId !== maintenance.deploymentId) {
      throw new Error("Production reset stopped: maintenance schedule pause could not be verified.");
    }
    maintenancePaused = true;
    const operations = resetOperations(tables, storage, users);
    deletionResult = await deleteProductionTestData({
      listStorageFileIds: () => operations.listStorageFileIds().catch((error) => { throw operationStage(error, "Storage listing"); }),
      deleteStorageFile: (fileId) => operations.deleteStorageFile(fileId).catch((error) => { throw operationStage(error, "Storage deletion"); }),
      listRowIds: (tableId) => operations.listRowIds(tableId).catch((error) => { throw operationStage(error, `${tableId} listing`); }),
      deleteRow: (tableId, rowId) => operations.deleteRow(tableId, rowId).catch((error) => { throw operationStage(error, `${tableId} deletion`); }),
      listAuthUserIds: () => operations.listAuthUserIds().catch((error) => { throw operationStage(error, "Auth listing"); }),
      deleteAuthUser: (userId) => operations.deleteAuthUser(userId).catch((error) => { throw operationStage(error, "Auth deletion"); }),
    });
  } catch (error) {
    resetError = error;
  } finally {
    if (maintenancePaused) {
      try {
        await functions.update({
          functionId: FUNCTION_ID,
          name: maintenance.name,
          schedule: EXPECTED_MAINTENANCE_SCHEDULE,
          enabled: true,
          execute: [],
        });
        const restored = await functions.get({ functionId: FUNCTION_ID });
        if (restored.schedule !== EXPECTED_MAINTENANCE_SCHEDULE || !restored.enabled || restored.execute.length !== 0 || restored.deploymentId !== maintenance.deploymentId) {
          throw new Error("Maintenance restoration verification failed.");
        }
      } catch (restoreError) {
        resetError = resetError ?? restoreError;
      }
    }
  }
  if (resetError) throw resetError;

  const after = await buildInventory({ env, tables, storage, users });
  const nonMetadataRows = Object.entries(after.rowCounts).filter(([tableId, count]) => tableId !== "schema_metadata" && count !== 0);
  if (after.authUserCount !== 0 || after.storageFileCount !== 0 || nonMetadataRows.length !== 0 || after.rowCounts.schema_metadata !== 1 || after.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error("Production reset stopped: post-reset zero-state verification failed.");
  }
  console.log(JSON.stringify({
    mode: "completed",
    backup: { label: "PRE-LAUNCH TEST-DATA BACKUP", directory: backupDirectory, verified: true },
    deletion: deletionResult,
    after,
    maintenance: {
      paused: true,
      restored: true,
      schedule: EXPECTED_MAINTENANCE_SCHEDULE,
      activeDeploymentId: maintenance.deploymentId,
      clientExecutePermissions: 0,
    },
    allowlist: { unchanged: true, approvedSlots: env.approvedEmails.size },
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    status: "stopped",
    errorClass: error instanceof Error ? error.name : "UnknownError",
    providerCode: Number((error as { code?: unknown }).code) || undefined,
    reason: error instanceof Error && error.message.startsWith("Production reset") ? error.message : "Production reset stopped on an unexpected operator/provider failure.",
  }, null, 2));
  process.exitCode = 1;
}
