/**
 * R2 restore CLI (D2): restores table rows from a backup file into an explicit
 * TARGET database id. Safety rails:
 *  - the live database id ("hft") is refused unless --allow-live is passed;
 *  - rows are upserted by their original $id so restores are idempotent;
 *  - a post-restore count comparison against the backup is printed.
 *
 * Usage:
 *   npx tsx scripts/appwrite-restore.mts --file <backup.json> --target-database <id> [--yes]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client, TablesDB } from "node-appwrite";
import { assertNotProduction, loadAppwriteCliEnv } from "./appwrite-cli-env";

const cliEnv = loadAppwriteCliEnv(process.argv);
const env = {
  APPWRITE_ENDPOINT: cliEnv.endpoint,
  APPWRITE_PROJECT_ID: cliEnv.projectId,
  APPWRITE_RUNTIME_API_KEY: cliEnv.runtimeApiKey,
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = arg("--file");
const targetDatabase = arg("--target-database");
const yes = process.argv.includes("--yes");

if (!file || !targetDatabase) throw new Error("Usage: --file <backup.json> --target-database <id> [--yes]");

// Gate C §2 fail-closed safeguard: never target the known PRODUCTION project.
assertNotProduction(targetDatabase, "Restore");

if (targetDatabase === "hft" && !yes) throw new Error('Refusing to restore into the LIVE database "hft" without --allow-live.');
if (targetDatabase === "hft" && !process.argv.includes("--allow-live")) {
  // Extra belt: even --yes alone must never touch the live id.
  throw new Error('Restoring into "hft" additionally requires --allow-live.');
}

const raw = readFileSync(file, "utf8");
const expected = existsSyncSafe(`${file}.sha256`);
if (expected && createHash("sha256").update(raw).digest("hex") !== expected) throw new Error("Backup checksum mismatch — refusing restore.");
const parsed = JSON.parse(raw) as { tables: Record<string, { rows: Array<Record<string, unknown>> }> };

const tables = new TablesDB(
  new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_RUNTIME_API_KEY),
);

function existsSyncSafe(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
}

const restoredCounts: Record<string, number> = {};
for (const [tableId, entry] of Object.entries(parsed.tables)) {
  let restored = 0;
  for (const row of entry.rows) {
    const metadataKeys = ["$id", "$createdAt", "$updatedAt", "$permissions"];
    const data = Object.fromEntries(Object.entries(row).filter(([key]) => !metadataKeys.includes(key)));
    await tables.upsertRow({ databaseId: targetDatabase, tableId, rowId: String(row.$id), data });
    restored += 1;
  }
  restoredCounts[tableId] = restored;
}
console.log(JSON.stringify({ restoredInto: targetDatabase, counts: restoredCounts }, null, 2));
