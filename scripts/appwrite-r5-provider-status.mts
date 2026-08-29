/** Read-only, sanitized R5 Site and maintenance status proof. */
import { Client, Functions, Query, Sites } from "node-appwrite";
import { loadAppwriteCliEnv, sanitizeProjectMeta } from "./appwrite-cli-env";

const siteIdIndex = process.argv.indexOf("--site");
const siteId = siteIdIndex >= 0 ? process.argv[siteIdIndex + 1]?.trim() : "";
if (!siteId) throw new Error("Usage: --site <Appwrite Site ID>");

const env = loadAppwriteCliEnv(process.argv);
if (!env.bootstrapApiKey) throw new Error("The read-only provider proof requires the local bootstrap credential.");
const client = new Client().setEndpoint(env.endpoint).setProject(env.projectId).setKey(env.bootstrapApiKey);
const sites = new Sites(client);
const functions = new Functions(client);

const [site, siteDeployments, maintenance, executions, functionDeployments] = await Promise.all([
  sites.get({ siteId }).catch(() => undefined),
  sites.listDeployments({ siteId, queries: [Query.orderDesc("$createdAt"), Query.limit(5)], total: false }).catch(() => undefined),
  functions.get({ functionId: "maintenance" }),
  functions.listExecutions({ functionId: "maintenance", queries: [Query.orderDesc("$createdAt"), Query.limit(5)], total: false }).catch(() => undefined),
  functions.listDeployments({ functionId: "maintenance", queries: [Query.orderDesc("$createdAt"), Query.limit(5)], total: false }).catch(() => undefined),
]);

const latestExecution = executions?.executions[0];
const logText = `${latestExecution?.logs ?? ""}\n${latestExecution?.errors ?? ""}`;
const sensitiveLogPattern = /(?:\br_[a-f0-9]{20,}\b|\brf_[a-f0-9]{20,}\b|\.(?:jpe?g|png|webp)\b|api[_ -]?key|credential|secret|hmac|authorization\s*:|raw receipt)/i;
const expectedSiteVars = new Set([
  "APP_COMPOSITION",
  "HFT_APPWRITE_ENDPOINT",
  "HFT_APPWRITE_PROJECT_ID",
  "HFT_APPWRITE_RUNTIME_API_KEY",
  "HFT_AUTH_HMAC_SECRET",
  "HFT_ALLOWED_ACCOUNT_EMAILS",
  "HFT_APP_ORIGIN",
]);
const deployedVarNames = site?.vars.map((entry) => entry.key).sort() ?? [];

console.log(JSON.stringify({
  ...sanitizeProjectMeta(env),
  site: site ? {
    readAvailable: true,
    enabled: site.enabled,
    live: site.live,
    framework: site.framework,
    adapter: site.adapter,
    buildRuntime: site.buildRuntime,
    timeout: site.timeout,
    installCommand: site.installCommand,
    buildCommand: site.buildCommand,
    outputDirectory: site.outputDirectory,
    providerBranch: site.providerBranch,
    providerRootDirectory: site.providerRootDirectory,
    deploymentRetentionDays: site.deploymentRetention,
    activeDeploymentId: site.deploymentId,
    latestDeploymentId: site.latestDeploymentId,
    latestDeploymentStatus: site.latestDeploymentStatus,
    deployedVarNames,
    exactExpectedVarManifest: deployedVarNames.length === expectedSiteVars.size && deployedVarNames.every((name) => expectedSiteVars.has(name)),
    recentDeployments: siteDeployments?.deployments.map((deployment) => ({ id: deployment.$id, status: deployment.status, active: deployment.activate, createdAt: deployment.$createdAt })) ?? [],
  } : { readAvailable: false },
  maintenance: {
    enabled: maintenance.enabled,
    runtime: maintenance.runtime,
    timeout: maintenance.timeout,
    schedule: maintenance.schedule,
    execute: maintenance.execute,
    activeDeploymentId: maintenance.deploymentId,
    recentDeployments: functionDeployments?.deployments.map((deployment) => ({ id: deployment.$id, status: deployment.status, active: deployment.activate, createdAt: deployment.$createdAt })) ?? [],
    deploymentReadAvailable: Boolean(functionDeployments),
    executionReadAvailable: Boolean(executions),
    latestExecution: latestExecution ? {
      createdAt: latestExecution.$createdAt,
      trigger: latestExecution.trigger,
      status: latestExecution.status,
      responseStatusCode: latestExecution.responseStatusCode,
      durationSeconds: latestExecution.duration,
      logChars: latestExecution.logs.length,
      errorChars: latestExecution.errors.length,
      sensitiveLogPattern: sensitiveLogPattern.test(logText),
    } : null,
  },
}, null, 2));
