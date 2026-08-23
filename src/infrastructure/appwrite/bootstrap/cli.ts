import { Client, Functions, Storage, TablesDB } from "node-appwrite";
import { loadAppwriteServerConfig, mergeDotEnvFile } from "../config";
import { appwriteSchemaReader, planSchemaApplication } from "./planner";
import { applySchemaPlan } from "./apply";

interface BootstrapCliArgs {
  readonly mode: "plan" | "apply";
  readonly confirm: boolean;
}

function parseArgs(argv: readonly string[]): BootstrapCliArgs {
  const mode = argv[0] === "apply" ? "apply" : argv[0] === "plan" ? "plan" : undefined;
  if (!mode) throw new Error("Usage: tsx src/infrastructure/appwrite/bootstrap/cli.ts <plan|apply> [--yes]");
  return { mode, confirm: argv.includes("--yes") };
}

async function main(): Promise<void> {
  mergeDotEnvFile(".env.local");
  mergeDotEnvFile(".env");
  const { mode, confirm } = parseArgs(process.argv.slice(2));
  const config = loadAppwriteServerConfig();
  if (!config.ok || !config.value) {
    console.error("Appwrite configuration is invalid:", config.errors?.join(" "));
    process.exitCode = 1;
    return;
  }
  const value = config.value;
  if (mode === "apply") {
    if (!value.bootstrapApiKey) {
      console.error("APPWRITE_BOOTSTRAP_API_KEY is required for apply. Plan mode needs no secrets.");
      process.exitCode = 1;
      return;
    }
    if (!confirm) {
      console.error("Refusing to mutate remote resources without --yes.");
      process.exitCode = 1;
      return;
    }
  }
  const makeClient = () =>
    new Client().setEndpoint(value.endpoint).setProject(value.projectId).setKey(value.bootstrapApiKey ?? "");
  const clients = {
    functions: new Functions(makeClient()),
    storage: new Storage(makeClient()),
    tablesDB: new TablesDB(makeClient()),
  };
  const plan = await planSchemaApplication(appwriteSchemaReader(clients));
  console.log(JSON.stringify(plan, null, 2));
  if (mode === "apply") {
    const result = await applySchemaPlan(plan, clients, { dryRun: false });
    console.log("Applied operations:\n" + result.performed.map((action) => ` - ${action}`).join("\n"));
  } else {
    console.log("Plan only; no resources were modified.");
  }
}

void main();
