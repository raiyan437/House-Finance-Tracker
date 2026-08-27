/**
 * R2 backup CLI (D2): exports every business/infrastructure table plus schema
 * metadata into a single timestamped JSON file under APPWRITE_BACKUP_DIR
 * (default: <home>/hft-backups — always outside the repository), then writes a
 * SHA-256 checksum manifest.
 *
 * Scope: DATABASE ROWS ONLY. Receipt Storage binaries are NOT included; they
 * are an explicitly tracked gap until the storage slice defines binary backup.
 *
 * Usage: npx tsx scripts/appwrite-backup.mts [--verify <backup-file>]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client, Query, TablesDB } from "node-appwrite";
import { loadAppwriteCliEnv } from "./appwrite-cli-env";

const cliEnv = loadAppwriteCliEnv(process.argv);
const env = {
  APPWRITE_ENDPOINT: cliEnv.endpoint,
  APPWRITE_PROJECT_ID: cliEnv.projectId,
  APPWRITE_RUNTIME_API_KEY: cliEnv.runtimeApiKey,
};

const TABLE_IDS = [
  "profiles",
  "households",
  "memberships",
  "join_requests",
  "expenses",
  "expense_card_private_details",
  "settlements",
  "cards",
  "receipt_metadata",
  "audit_events",
  "command_outcomes",
  "coordination_guards",
  "receipt_reservations",
  "schema_metadata",
] as const;

const tables = new TablesDB(
  new Client().setEndpoint(env.APPWRITE_ENDPOINT).setProject(env.APPWRITE_PROJECT_ID).setKey(env.APPWRITE_RUNTIME_API_KEY),
);

async function exportTable(tableId: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  let cursor: string | undefined;
  do {
    const pageQueries = [Query.limit(100)];
    const page = await tables.listRows({
      databaseId: "hft",
      tableId,
      queries: cursor ? [...pageQueries, Query.cursorAfter(cursor)] : pageQueries,
    });
    rows.push(...page.rows);
    cursor = page.rows.length === 100 ? page.rows[page.rows.length - 1]?.$id : undefined;
  } while (cursor);
  return rows;
}

const verifyTarget = process.argv[2] === "--verify" ? process.argv[3] : undefined;

if (verifyTarget) {
  if (!existsSync(verifyTarget)) throw new Error(`Backup file not found: ${verifyTarget}`);
  const raw = readFileSync(verifyTarget, "utf8");
  const expected = readFileSync(`${verifyTarget}.sha256`, "utf8").trim();
  const actual = createHash("sha256").update(raw).digest("hex");
  const parsed = JSON.parse(raw) as { tables: Record<string, { count: number }> };
  const counts = Object.fromEntries(Object.entries(parsed.tables).map(([id, entry]) => [id, entry.count]));
  console.log(JSON.stringify({ verify: actual === expected, sha256: actual, counts }, null, 2));
  if (actual !== expected) process.exit(1);
} else {
  const backupDir = process.env.APPWRITE_BACKUP_DIR ?? join(homedir(), "hft-backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const tablesExport: Record<string, { count: number; rows: unknown[] }> = {};
  for (const tableId of TABLE_IDS) {
    const rows = await exportTable(tableId);
    tablesExport[tableId] = { count: rows.length, rows };
  }
  const payload = JSON.stringify({
    createdAt: new Date().toISOString(),
    projectId: env.APPWRITE_PROJECT_ID,
    scope: "database-rows-only; receipt Storage binaries excluded (R4)",
    tables: tablesExport,
  }, null, 2);
  const file = join(backupDir, `hft-backup-${stamp}.json`);
  writeFileSync(file, payload, "utf8");
  const checksum = createHash("sha256").update(payload).digest("hex");
  writeFileSync(`${file}.sha256`, checksum, "utf8");
  console.log(JSON.stringify({ written: file, sha256: checksum, counts: Object.fromEntries(Object.entries(tablesExport).map(([id, e]) => [id, e.count])) }, null, 2));
}
