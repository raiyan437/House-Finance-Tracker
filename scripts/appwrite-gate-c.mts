/**
 * Gate C drill orchestrator (R2 §1-§12) — runs ONLY against a disposable
 * Appwrite project configured in .env.gate-c.local (isolated credentials).
 *
 * Fail-closed safeguards:
 *  - refuses to run when .env.gate-c.local is missing;
 *  - refuses when the connected project id equals the PRODUCTION project id;
 *  - prints sanitized connection proof (env file, endpoint host, project id)
 *    before every destructive subcommand;
 *  - restore/destructive steps additionally inherit the production-project
 *    guard implemented in scripts/appwrite-restore.mts.
 *
 * Subcommands: check-config | seed | delete-drill | cleanup
 * (backup/verify/restore reuse the approved CLIs with --env-file/.isolated.)
 *
 * Usage: npx tsx scripts/appwrite-gate-c.mts --isolated <subcommand>
 */
import { randomUUID } from "node:crypto";
import { Client, TablesDB } from "node-appwrite";
import { assertNotProduction, loadAppwriteCliEnv, sanitizeProjectMeta } from "./appwrite-cli-env";

const argv = process.argv.slice(2);
if (!argv.includes("--isolated")) {
  throw new Error("Gate C tooling requires --isolated (explicit disposable-project configuration).");
}
const env = loadAppwriteCliEnv(argv);
const subcommand = argv.find((arg) => !arg.startsWith("--"));

// Fail-closed: never operate on the production project.
assertNotProduction(env.projectId, "Gate C drill");

const tables = new TablesDB(
  new Client().setEndpoint(env.endpoint).setProject(env.projectId).setKey(env.runtimeApiKey),
);

const DATABASE = "hft";
const FIX = `gatec-${randomUUID().slice(0, 6)}`;
const HH = `h_${FIX}`;
const LEADER = `u_l_${FIX.slice(6)}`;
const MEMBER = `u_m_${FIX.slice(6)}`;
const JR_PENDING = `j_wait_${FIX.slice(6)}`;
const JR_TERMINAL = `j_done_${FIX.slice(6)}`;

function meta(): void {
  console.log("[gate-c] connection proof:", JSON.stringify(sanitizeProjectMeta(env)));
}

async function put(tableId: string, rowId: string, data: Record<string, unknown>): Promise<void> {
  await tables.upsertRow({ databaseId: DATABASE, tableId, rowId, data });
}

async function seed(): Promise<void> {
  meta();
  const now = new Date().toISOString();
  await put("households", HH, { name: "GateC House", code: `9${FIX.replace(/\D/g, "").padStart(8, "0").slice(0, 8)}`, version: 1, createdAt: now, updatedAt: now });
  await put("memberships", `m_${HH}_${LEADER}`, { householdId: HH, userId: LEADER, role: "leader", status: "active", joinedAt: now, leftAt: null, statusChangedAt: now, version: 1 });
  await put("memberships", `m_${HH}_${MEMBER}`, { householdId: HH, userId: MEMBER, role: "member", status: "active", joinedAt: now, leftAt: null, statusChangedAt: now, version: 1 });
  // Terminal join request (rejected, fully resolved).
  await put("join_requests", JR_TERMINAL, { householdId: HH, userId: MEMBER, status: "rejected", requesterDisplayName: null, createdAt: now, resolvedAt: now, resolvedByUserId: LEADER });
  // Pending join request (proves household-closed closure on deletion).
  await put("join_requests", JR_PENDING, { householdId: HH, userId: `u_w_${FIX.slice(6)}`, status: "pending", requesterDisplayName: null, createdAt: now, resolvedAt: null, resolvedByUserId: null });
  // Zero-net retained financial history: two equal-and-opposite expenses.
  for (const [expenseId, payer, shareA, shareB] of [["e_ga", LEADER, 10000, 10000], ["e_gb", MEMBER, 10000, 10000]] as const) {
    await put("expenses", `${expenseId}_${FIX.slice(6)}`, {
      householdId: HH, expenseDate: "2026-08-01", amountPoisha: String(shareA + shareB),
      payerId: payer, createdBy: payer, splitMethod: "equal", name: `Zero-net ${expenseId}`,
      paymentMethod: "cash", paymentRefJson: "{}",
      allocationsJson: JSON.stringify([
        { participantId: LEADER, sharePoisha: String(shareA) },
        { participantId: MEMBER, sharePoisha: String(shareB) },
      ]),
      percentageEntriesJson: null, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, deletedByUserId: null,
    });
  }
  // Coordination guards mirroring live state.
  await put("coordination_guards", `g_active-membership:${LEADER}`.slice(0, 36), { logicalKey: `active-membership:${LEADER}`, ownerValue: LEADER, counter: 0, version: 0, createdAt: now });
  await put("coordination_guards", `g_active-membership:${MEMBER}`.slice(0, 36), { logicalKey: `active-membership:${MEMBER}`, ownerValue: MEMBER, counter: 0, version: 0, createdAt: now });
  await put("coordination_guards", `g_active-leader:${HH}`.slice(0, 36), { logicalKey: `active-leader:${HH}`, ownerValue: LEADER, counter: 0, version: 0, createdAt: now });
  await put("coordination_guards", `g_financial:${HH}`.slice(0, 36), { logicalKey: `financial:${HH}`, ownerValue: null, counter: 0, version: 0, createdAt: now });
  await put("coordination_guards", `g_pending-join:${`u_w_${FIX.slice(6)}`}`.slice(0, 36), { logicalKey: `pending-join:${`u_w_${FIX.slice(6)}`}`, ownerValue: `u_w_${FIX.slice(6)}`, counter: 0, version: 0, createdAt: now });
  // Sanitized audit history + an idempotency outcome (household create).
  await put("audit_events", `a_seed_${FIX.slice(6)}`, { householdId: HH, aggregateType: "household", aggregateId: HH, actorId: LEADER, action: "created", changedFieldsJson: '["name","code"]', occurredAt: now });
  await put("audit_events", `a_exp_${FIX.slice(6)}`, { householdId: HH, aggregateType: "expense", aggregateId: `e_ga_${FIX.slice(6)}`, actorId: LEADER, action: "created", changedFieldsJson: '["amount"]', occurredAt: now });
  await put("command_outcomes", `c_seed_${FIX.slice(6)}`, { actorId: LEADER, commandType: "create-household", commandId: `k_seed_${FIX.slice(6)}`, intentDigest: "sha256:gatec-seed", resourceId: HH, completedAt: now });
  console.log(JSON.stringify({ seeded: true, fixturePrefix: FIX, householdId: HH, leader: LEADER, member: MEMBER }, null, 2));
}

async function deleteDrill(): Promise<void> {
  meta();
  // Exercise the REAL trusted kernel against the disposable project.
  const { AppwriteCommandPersistence } = await import("../src/infrastructure/appwrite/runtime/command-persistence.server");
  const persistence = new AppwriteCommandPersistence(tables);
  const now = new Date().toISOString();
  const commandId = `k_del_${randomUUID().slice(0, 8)}`;
  const envelopeModule = await import("../src/infrastructure/appwrite/runtime/command-envelope.server");
  const runOnce = () => envelopeModule.runWithCommandEnvelope(
    { commandType: "delete-household", commandId, intentSeed: { householdId: HH } },
    () => persistence.deleteHousehold({ householdId: HH as never, actorId: LEADER as never, auditEvent: {
      auditEventId: `a_del_${commandId}` as never,
      householdId: HH as never,
      actorId: LEADER as never,
      aggregateType: "household",
      aggregateId: HH,
      action: "deleted",
      occurredAt: now as never,
      changedFields: ["deletedAt"],
    }, joinRequestAuditIdBase: `a_deljr_${commandId}` as never }),
  );

  await runOnce();
  const stagedFirst = persistence.lastDeleteStagedOperations;

  // Lost-response retry: same command id must replay sanitized success.
  await runOnce();

  // Changed intent: same command id, different household target.
  let changedIntentCode = "none";
  try {
    await envelopeModule.runWithCommandEnvelope(
      { commandType: "delete-household", commandId, intentSeed: { householdId: "h_other_target" } },
      () => persistence.deleteHousehold({ householdId: "h_other_target" as never, actorId: LEADER as never, auditEvent: {
        auditEventId: `a_del_other_${commandId}` as never, householdId: "h_other_target" as never,
        actorId: LEADER as never, aggregateType: "household", aggregateId: "h_other_target",
        action: "deleted", occurredAt: now as never, changedFields: ["deletedAt"],
      }, joinRequestAuditIdBase: `a_jr_other_${commandId}` as never }),
    );
  } catch (error) {
    changedIntentCode = (error as { code?: string }).code ?? (error as Error).name;
  }

  // Post-delete state snapshot for evidence.
  const hh = await tables.getRow({ databaseId: DATABASE, tableId: "households", rowId: HH }).catch(() => undefined);
  const memberships = await tables.listRows({ databaseId: DATABASE, tableId: "memberships" });
  const requests = await tables.listRows({ databaseId: DATABASE, tableId: "join_requests" });
  const guards = await tables.listRows({ databaseId: DATABASE, tableId: "coordination_guards" });
  const audits = await tables.listRows({ databaseId: DATABASE, tableId: "audit_events" });
  const outcomes = await tables.listRows({ databaseId: DATABASE, tableId: "command_outcomes" });

  console.log(JSON.stringify({
    firstCommitStagedOperations: stagedFirst,
    lostResponseReplay: "success",
    changedIntentRejectedAs: changedIntentCode,
    tombstone: hh ? { deletedAt: hh.deletedAt, deletedByUserId: hh.deletedByUserId } : "MISSING",
    membershipsAllFormer: (memberships.rows as Record<string, unknown>[]).filter((r) => r.householdId === HH).every((r) => r.status === "former"),
    pendingRequestClosed: (requests.rows as Record<string, unknown>[]).find((r) => r.$id === JR_PENDING)?.status === "household-closed",
    householdGuardsRemaining: (guards.rows as Record<string, unknown>[]).filter((r) => String(r.logicalKey).includes(String(HH))).length,
    deletedAudits: (audits.rows as Record<string, unknown>[]).filter((r) => r.action === "deleted").length,
    closedAudits: (audits.rows as Record<string, unknown>[]).filter((r) => r.action === "household-closed").length,
    outcomeRowsForCommand: (outcomes.rows as Record<string, unknown>[]).filter((r) => String(r.commandId) === commandId).length,
    expensesPreserved: (await tables.listRows({ databaseId: DATABASE, tableId: "expenses" })).total,
  }, null, 2));
}

async function cleanup(): Promise<void> {
  meta();
  const commandIdOfLastRun = process.env.GATE_C_LAST_COMMAND_ID ?? "";
  let removed = 0;
  const targets: Array<[string, string]> = [
    ["households", HH], ["memberships", `m_${HH}_${LEADER}`], ["memberships", `m_${HH}_${MEMBER}`],
    ["join_requests", JR_PENDING], ["join_requests", JR_TERMINAL],
    ["expenses", `e_ga_${FIX.slice(6)}`], ["expenses", `e_gb_${FIX.slice(6)}`],
    ["audit_events", `a_seed_${FIX.slice(6)}`], ["audit_events", `a_exp_${FIX.slice(6)}`],
    ["command_outcomes", `c_seed_${FIX.slice(6)}`],
  ];
  for (const [tableId, rowId] of targets) {
    await tables.deleteRow({ databaseId: DATABASE, tableId, rowId }).then(() => { removed += 1; }).catch(() => undefined);
  }
  const guards = await tables.listRows({ databaseId: DATABASE, tableId: "coordination_guards" });
  for (const row of guards.rows as Record<string, unknown>[]) {
    if (String(row.logicalKey).includes(FIX) || String(row.logicalKey).includes(HH)) {
      await tables.deleteRow({ databaseId: DATABASE, tableId: "coordination_guards", rowId: String(row.$id) }).then(() => { removed += 1; }).catch(() => undefined);
    }
  }
  const audits = await tables.listRows({ databaseId: DATABASE, tableId: "audit_events" });
  for (const row of audits.rows as Record<string, unknown>[]) {
    if (String(row.$id).includes("a_del_") || String(row.$id).startsWith(`a_deljr_${commandIdOfLastRun}`)) {
      await tables.deleteRow({ databaseId: DATABASE, tableId: "audit_events", rowId: String(row.$id) }).then(() => { removed += 1; }).catch(() => undefined);
    }
  }
  const outcomes = await tables.listRows({ databaseId: DATABASE, tableId: "command_outcomes" });
  for (const row of outcomes.rows as Record<string, unknown>[]) {
    if (String(row.resourceId) === HH) {
      await tables.deleteRow({ databaseId: DATABASE, tableId: "command_outcomes", rowId: String(row.$id) }).then(() => { removed += 1; }).catch(() => undefined);
    }
  }
  console.log(JSON.stringify({ cleanedRows: removed }));
}
const TABLE_IDS_FOR_CLEANUP: readonly string[] = [];
let commandIdOfLastRun: string | undefined;
void TABLE_IDS_FOR_CLEANUP;
void commandIdOfLastRun;

switch (subcommand) {
  case "seed": await seed(); break;
  case "delete-drill": await deleteDrill(); break;
  case "cleanup": await cleanup(); break;
  case "check-config":
    meta();
    console.log('[gate-c] config OK; next: backup -> verify -> seed -> delete-drill -> restore --file <backup> --target-database <disposable-db> --yes');
    break;
  default:
    throw new Error("Usage: gate-c.mts --isolated [check-config|seed|delete-drill|cleanup]");
}
