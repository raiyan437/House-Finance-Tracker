/**
 * Packages and activates the approved R4 maintenance Function deployment.
 * This is an explicit provider mutation and therefore requires --yes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Client, Functions, ProjectKeyScopes, Runtime } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { loadAppwriteCliEnv, sanitizeProjectMeta } from "./appwrite-cli-env";

if (!process.argv.includes("--yes")) throw new Error("Refusing to deploy without --yes.");
const env = loadAppwriteCliEnv(process.argv);
if (!env.bootstrapApiKey) throw new Error("APPWRITE_BOOTSTRAP_API_KEY is required for Function deployment.");
const source = resolve("functions/maintenance");
const temporary = mkdtempSync(join(tmpdir(), "hft-maintenance-deploy-"));
const archive = join(temporary, "maintenance.tar.gz");

try {
  const packaged = spawnSync("tar", ["-czf", archive, "-C", source, "."], { encoding: "utf8" });
  if (packaged.status !== 0) throw new Error(`Function packaging failed: ${packaged.stderr.trim()}`);
  const client = new Client().setEndpoint(env.endpoint).setProject(env.projectId).setKey(env.bootstrapApiKey);
  const functions = new Functions(client);
  await functions.update({
    functionId: "maintenance",
    name: "Maintenance worker",
    runtime: Runtime.Node22,
    execute: [],
    events: [],
    schedule: "0 0 * * *",
    timeout: 300,
    enabled: true,
    logging: true,
    entrypoint: "src/main.js",
    commands: "npm install",
    scopes: [
      ProjectKeyScopes.TablesRead,
      ProjectKeyScopes.TablesWrite,
      ProjectKeyScopes.RowsRead,
      ProjectKeyScopes.RowsWrite,
      ProjectKeyScopes.FilesRead,
      ProjectKeyScopes.FilesWrite,
    ],
  });
  const deployment = await functions.createDeployment({
    functionId: "maintenance",
    code: InputFile.fromPath(archive),
    activate: true,
    entrypoint: "src/main.js",
    commands: "npm install",
  });
  let current = deployment;
  for (let attempt = 0; attempt < 180 && !["ready", "failed", "canceled"].includes(current.status); attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
    current = await functions.getDeployment({ functionId: "maintenance", deploymentId: deployment.$id });
  }
  if (current.status !== "ready") throw new Error(`Maintenance deployment did not become ready (status: ${current.status}).`);
  const configured = await functions.get({ functionId: "maintenance" });
  if (configured.deploymentId !== deployment.$id || configured.entrypoint !== "src/main.js" || configured.execute.length !== 0) {
    throw new Error("Maintenance deployment activation/configuration verification failed.");
  }
  console.log(JSON.stringify({ ...sanitizeProjectMeta(env), functionId: "maintenance", deploymentId: deployment.$id, status: current.status, active: true, entrypoint: configured.entrypoint }, null, 2));
} finally {
  // The path is created by mkdtemp under the OS temp directory and resolved exactly above.
  rmSync(temporary, { recursive: true, force: true });
}
