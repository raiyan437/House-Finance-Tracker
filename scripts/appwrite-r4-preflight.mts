/** Read-only, sanitized R4 provider-configuration proof. */
import { Client, Functions, Storage, TablesDB } from "node-appwrite";
import { loadAppwriteCliEnv, sanitizeProjectMeta } from "./appwrite-cli-env";

const env = loadAppwriteCliEnv(process.argv);
const client = new Client().setEndpoint(env.endpoint).setProject(env.projectId).setKey(env.runtimeApiKey);
const tables = new TablesDB(client);
const configurationClient = new Client().setEndpoint(env.endpoint).setProject(env.projectId).setKey(env.bootstrapApiKey ?? "");
const storage = new Storage(configurationClient);
const functions = new Functions(configurationClient);

const [bucketList, bucket, maintenance, schema] = await Promise.all([
  storage.listBuckets({ total: false }),
  storage.getBucket({ bucketId: "receipts" }),
  functions.get({ functionId: "maintenance" }),
  tables.getRow({ databaseId: "hft", tableId: "schema_metadata", rowId: "active" }),
]);

const proof = {
  ...sanitizeProjectMeta(env),
  schemaVersion: Number(schema.version),
  receiptBucketCount: bucketList.buckets.filter((entry) => entry.$id === "receipts").length,
  receiptBucket: {
    enabled: bucket.enabled,
    fileSecurity: bucket.fileSecurity,
    permissions: bucket.$permissions,
    maximumFileSize: bucket.maximumFileSize,
    allowedFileExtensions: [...bucket.allowedFileExtensions].sort(),
  },
  maintenanceFunction: {
    enabled: maintenance.enabled,
    runtime: maintenance.runtime,
    execute: maintenance.execute,
    schedule: maintenance.schedule,
    timeout: maintenance.timeout,
    scopes: [...maintenance.scopes].sort(),
    hasActiveDeployment: Boolean(maintenance.deploymentId),
    entrypoint: maintenance.entrypoint,
    commands: maintenance.commands,
  },
};

console.log(JSON.stringify(proof, null, 2));
