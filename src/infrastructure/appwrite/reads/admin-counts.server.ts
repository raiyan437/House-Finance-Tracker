import "server-only";
import { createAppwriteAuthClients } from "../auth/clients.server";
import { loadAppwriteServerConfig } from "../config";
import { DATABASE_ID } from "../schema/definitions";

/**
 * R1 live-smoke admin helper: prints sanitized business-table row counts
 * (server-side only, never exposes keys) so the deferred first-login proof can
 * verify idempotent Profile bootstrap without touching credentials.
 *
 * Run: npx tsx -e or via `npm run appwrite:counts` style wiring if authorized.
 */

const BUSINESS_TABLES = [
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
] as const;

export async function printBusinessTableRowCounts(): Promise<void> {
  const config = loadAppwriteServerConfig();
  if (!config.ok || !config.value) {
    throw new Error("Configuration is unavailable for the counts check.");
  }
  const tablesDB = createAppwriteAuthClients(config.value).tablesDB();
  const counts: Record<string, number> = {};
  for (const tableId of BUSINESS_TABLES) {
    const result = await tablesDB.listRows({ databaseId: DATABASE_ID, tableId, queries: [] });
    counts[tableId] = result.total ?? result.rows.length;
  }
  console.log("[r1-counts]", JSON.stringify(counts));
}
