import { createHash, randomUUID } from "node:crypto";
import { Client, Query, Storage, TablesDB } from "node-appwrite";

const DATABASE_ID = "hft";
const BUCKET_ID = "receipts";
const PAGE_SIZE = 25;
const WORK_BUDGET_MS = 240_000;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const WARNING_BYTES = 800_000_000;
const TABLE = {
  receipts: "receipt_metadata",
  reservations: "receipt_reservations",
  guards: "coordination_guards",
};

function derivedId(prefix, logicalKey) {
  return `${prefix}${createHash("sha256").update(logicalKey).digest("hex").slice(0, 34)}`;
}

function guardId(logicalKey) {
  return derivedId("g_", logicalKey);
}

function storageIdFromReservation(reservationId) {
  return reservationId.startsWith("q_") ? `f_${reservationId.slice(2)}` : undefined;
}

function metadataIdFromStorage(fileId) {
  return fileId.startsWith("f_") ? `r_${fileId.slice(2)}` : undefined;
}

function reservationIdFromStorage(fileId) {
  return fileId.startsWith("f_") ? `q_${fileId.slice(2)}` : undefined;
}

export function retainedReceiptCutoff(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const retainedMonthIndex = year * 12 + (month - 1) - 2;
  const cutoffYear = Math.floor(retainedMonthIndex / 12);
  const cutoffMonth = retainedMonthIndex % 12;
  // Dhaka is UTC+06 year-round, so local midnight is 18:00Z on the prior day.
  return new Date(Date.UTC(cutoffYear, cutoffMonth, 1, -6)).toISOString();
}

function isNotFound(error) {
  return Number(error?.code) === 404;
}

async function optional(run) {
  try {
    return await run();
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function transaction(tables, work) {
  const created = await tables.createTransaction({ ttl: 60 });
  try {
    const value = await work(String(created.$id));
    await tables.updateTransaction({ transactionId: String(created.$id), commit: true });
    return value;
  } catch (error) {
    await tables.updateTransaction({ transactionId: String(created.$id), rollback: true }).catch(() => undefined);
    throw error;
  }
}

async function acquireLease(tables, nowMs, runId) {
  const logicalKey = "maintenance:lease";
  const rowId = guardId(logicalKey);
  return transaction(tables, async (transactionId) => {
    const row = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId, transactionId }));
    if (row && Number(row.counter) > nowMs) return false;
    const data = row
      ? { ownerValue: runId, counter: nowMs + LEASE_MS, version: Number(row.version) + 1 }
      : { logicalKey, ownerValue: runId, counter: nowMs + LEASE_MS, version: 1, createdAt: new Date(nowMs).toISOString() };
    if (row) await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId, data, transactionId });
    else await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId, data, transactionId });
    return true;
  });
}

async function releaseLease(tables, runId) {
  const logicalKey = "maintenance:lease";
  const rowId = guardId(logicalKey);
  await transaction(tables, async (transactionId) => {
    const row = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId, transactionId }));
    if (!row || row.ownerValue !== runId) return;
    await tables.updateRow({
      databaseId: DATABASE_ID,
      tableId: TABLE.guards,
      rowId,
      data: { ownerValue: null, counter: 0, version: Number(row.version) + 1 },
      transactionId,
    });
  });
}

async function cursor(tables, stage) {
  const row = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId: guardId(`maintenance:cursor:${stage}`) }));
  return typeof row?.ownerValue === "string" && row.ownerValue ? row.ownerValue : undefined;
}

async function saveCursor(tables, stage, value, now) {
  const logicalKey = `maintenance:cursor:${stage}`;
  const rowId = guardId(logicalKey);
  const row = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId }));
  const data = row
    ? { ownerValue: value ?? null, version: Number(row.version) + 1 }
    : { logicalKey, ownerValue: value ?? null, counter: 0, version: 1, createdAt: now };
  if (row) await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId, data });
  else await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId, data });
}

async function counterValue(tables, transactionId, logicalKey) {
  const rowId = guardId(logicalKey);
  const row = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId, transactionId }));
  return { row, rowId, value: row ? Number(row.counter) : 0 };
}

async function writeCounter(tables, transactionId, logicalKey, value, now) {
  const current = await counterValue(tables, transactionId, logicalKey);
  const safe = Math.max(0, value);
  if (current.row) {
    await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId: current.rowId, data: { counter: safe, version: Number(current.row.version) + 1 }, transactionId });
  } else {
    await tables.createRow({ databaseId: DATABASE_ID, tableId: TABLE.guards, rowId: current.rowId, data: { logicalKey, ownerValue: null, counter: safe, version: 1, createdAt: now }, transactionId });
  }
}

async function releaseReceiptCapacity(tables, transactionId, receipt, now) {
  const keys = [
    `receipt-count:${receipt.expenseId}`,
    `receipt-uploader-bytes:${receipt.uploaderId}`,
    "receipt-project-bytes",
  ];
  const deltas = [1, Number(receipt.sizeBytes), Number(receipt.sizeBytes)];
  for (let index = 0; index < keys.length; index += 1) {
    const current = await counterValue(tables, transactionId, keys[index]);
    await writeCounter(tables, transactionId, keys[index], current.value - deltas[index], now);
  }
}

async function retentionStage({ tables, storage, now, cutoff, withinBudget }) {
  const previous = await cursor(tables, "retention");
  const queries = [Query.equal("contentState", "available"), Query.lessThan("createdAt", cutoff), Query.orderAsc("createdAt"), Query.limit(PAGE_SIZE)];
  const page = await tables.listRows({ databaseId: DATABASE_ID, tableId: TABLE.receipts, queries: previous ? [...queries, Query.cursorAfter(previous)] : queries });
  let processed = 0;
  let lastCursor = previous;
  let completedPage = true;
  for (const candidate of page.rows) {
    if (!withinBudget()) {
      completedPage = false;
      break;
    }
    const current = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.receipts, rowId: candidate.$id }));
    if (current && current.contentState === "available" && String(current.createdAt) < cutoff) {
      await storage.deleteFile({ bucketId: BUCKET_ID, fileId: String(current.storageFileId) }).catch((error) => {
        if (!isNotFound(error)) throw error;
      });
      await transaction(tables, async (transactionId) => {
        const locked = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.receipts, rowId: current.$id, transactionId }));
        if (!locked || locked.contentState !== "available" || String(locked.createdAt) >= cutoff) return;
        await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.receipts, rowId: current.$id, data: { contentState: "retention-expired", contentRemovedAt: now, contentRemovedByUserId: null }, transactionId });
        await releaseReceiptCapacity(tables, transactionId, locked, now);
      });
      processed += 1;
    }
    lastCursor = String(candidate.$id);
  }
  const next = completedPage && page.rows.length < PAGE_SIZE ? undefined : lastCursor;
  await saveCursor(tables, "retention", next, now);
  return processed;
}

async function staleReservationStage({ tables, storage, now, withinBudget }) {
  const previous = await cursor(tables, "reservations");
  const queries = [Query.equal("state", ["reserved", "abandoned"]), Query.lessThan("expiresAt", now), Query.orderAsc("expiresAt"), Query.limit(PAGE_SIZE)];
  const page = await tables.listRows({ databaseId: DATABASE_ID, tableId: TABLE.reservations, queries: previous ? [...queries, Query.cursorAfter(previous)] : queries });
  let processed = 0;
  let lastCursor = previous;
  let completedPage = true;
  for (const candidate of page.rows) {
    if (!withinBudget()) {
      completedPage = false;
      break;
    }
    const claimed = candidate.state === "abandoned" || await transaction(tables, async (transactionId) => {
      const locked = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: candidate.$id, transactionId }));
      if (!locked || locked.state !== "reserved" || String(locked.expiresAt) >= now) return false;
      await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: candidate.$id, data: { state: "abandoned" }, transactionId });
      return true;
    });
    if (!claimed) {
      lastCursor = String(candidate.$id);
      continue;
    }
    const fileId = storageIdFromReservation(String(candidate.$id));
    const receiptId = fileId ? metadataIdFromStorage(fileId) : undefined;
    const metadata = receiptId ? await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.receipts, rowId: receiptId })) : undefined;
    if (metadata?.contentState === "available") {
      await transaction(tables, async (transactionId) => {
        const locked = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: candidate.$id, transactionId }));
        if (locked?.state === "abandoned") {
          await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: candidate.$id, data: { state: "finalized" }, transactionId });
        }
      });
      processed += 1;
      lastCursor = String(candidate.$id);
      continue;
    }
    if (fileId) {
      await storage.deleteFile({ bucketId: BUCKET_ID, fileId }).catch((error) => {
        if (!isNotFound(error)) throw error;
      });
    }
    await transaction(tables, async (transactionId) => {
      const locked = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: candidate.$id, transactionId }));
      if (!locked || locked.state !== "abandoned") return;
      await tables.updateRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: candidate.$id, data: { state: "released" }, transactionId });
    });
    processed += 1;
    lastCursor = String(candidate.$id);
  }
  const next = completedPage && page.rows.length < PAGE_SIZE ? undefined : lastCursor;
  await saveCursor(tables, "reservations", next, now);
  return processed;
}

async function orphanStage({ tables, storage, nowMs, now, withinBudget }) {
  const previous = await cursor(tables, "orphans");
  const queries = [Query.orderAsc("$createdAt"), Query.orderAsc("$id"), Query.limit(PAGE_SIZE)];
  const page = await storage.listFiles({ bucketId: BUCKET_ID, queries: previous ? [...queries, Query.cursorAfter(previous)] : queries });
  let processed = 0;
  let lastCursor = previous;
  let completedPage = true;
  for (const file of page.files) {
    if (!withinBudget()) {
      completedPage = false;
      break;
    }
    const receiptId = metadataIdFromStorage(file.$id);
    const reservationId = reservationIdFromStorage(file.$id);
    const [metadata, reservation] = await Promise.all([
      receiptId ? optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.receipts, rowId: receiptId })) : undefined,
      reservationId ? optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: reservationId })) : undefined,
    ]);
    const terminal = metadata && metadata.contentState !== "available";
    const untrackedAndOld = !metadata && !reservation && Date.parse(file.$createdAt) <= nowMs - ORPHAN_GRACE_MS;
    if (terminal || untrackedAndOld) {
      await storage.deleteFile({ bucketId: BUCKET_ID, fileId: file.$id }).catch((error) => {
        if (!isNotFound(error)) throw error;
      });
      processed += 1;
    }
    lastCursor = String(file.$id);
  }
  const next = completedPage && page.files.length < PAGE_SIZE ? undefined : lastCursor;
  await saveCursor(tables, "orphans", next, now);
  return processed;
}

async function quotaStage({ tables, now }) {
  const [receiptPage, reservationPage, guardPage] = await Promise.all([
    tables.listRows({ databaseId: DATABASE_ID, tableId: TABLE.receipts, queries: [Query.equal("contentState", "available"), Query.limit(5000)] }),
    tables.listRows({ databaseId: DATABASE_ID, tableId: TABLE.reservations, queries: [Query.equal("state", "reserved"), Query.limit(5000)] }),
    tables.listRows({ databaseId: DATABASE_ID, tableId: TABLE.guards, queries: [Query.limit(5000)] }),
  ]);
  const desired = new Map([["receipt-project-bytes", 0]]);
  for (const row of receiptPage.rows) {
    desired.set(`receipt-count:${row.expenseId}`, (desired.get(`receipt-count:${row.expenseId}`) ?? 0) + 1);
    desired.set(`receipt-uploader-bytes:${row.uploaderId}`, (desired.get(`receipt-uploader-bytes:${row.uploaderId}`) ?? 0) + Number(row.sizeBytes));
    desired.set("receipt-project-bytes", (desired.get("receipt-project-bytes") ?? 0) + Number(row.sizeBytes));
  }
  for (const row of reservationPage.rows) {
    desired.set(`receipt-count:${row.expenseId}`, (desired.get(`receipt-count:${row.expenseId}`) ?? 0) + 1);
    desired.set(`receipt-uploader-bytes:${row.uploaderId}`, (desired.get(`receipt-uploader-bytes:${row.uploaderId}`) ?? 0) + Number(row.bytes));
    desired.set("receipt-project-bytes", (desired.get("receipt-project-bytes") ?? 0) + Number(row.bytes));
  }
  for (const row of guardPage.rows) {
    const key = String(row.logicalKey ?? "");
    if (key.startsWith("receipt-count:") || key.startsWith("receipt-uploader-bytes:")) {
      if (!desired.has(key)) desired.set(key, 0);
    }
  }
  const ordered = [...desired].sort(([left], [right]) => guardId(left).localeCompare(guardId(right)));
  const previous = await cursor(tables, "quota");
  const start = previous ? Math.max(0, ordered.findIndex(([key]) => guardId(key) === previous) + 1) : 0;
  const page = ordered.slice(start, start + PAGE_SIZE);
  await transaction(tables, async (transactionId) => {
    for (const [key, value] of page) await writeCounter(tables, transactionId, key, value, now);
  });
  const next = start + page.length < ordered.length && page.length ? guardId(page.at(-1)[0]) : undefined;
  await saveCursor(tables, "quota", next, now);
  return { repaired: page.length, projectBytes: desired.get("receipt-project-bytes") ?? 0 };
}

async function terminalReservationStage({ tables, nowMs, now }) {
  const previous = await cursor(tables, "terminal-reservations");
  const queries = [Query.orderAsc("$id"), Query.limit(PAGE_SIZE)];
  const page = await tables.listRows({ databaseId: DATABASE_ID, tableId: TABLE.reservations, queries: previous ? [...queries, Query.cursorAfter(previous)] : queries });
  let removed = 0;
  for (const row of page.rows) {
    if (row.state !== "reserved" && Date.parse(String(row.createdAt)) <= nowMs - ORPHAN_GRACE_MS) {
      const didRemove = await transaction(tables, async (transactionId) => {
        const locked = await optional(() => tables.getRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: row.$id, transactionId }));
        if (!locked || locked.state === "reserved" || Date.parse(String(locked.createdAt)) > nowMs - ORPHAN_GRACE_MS) return false;
        await tables.deleteRow({ databaseId: DATABASE_ID, tableId: TABLE.reservations, rowId: row.$id, transactionId });
        return true;
      });
      if (didRemove) removed += 1;
    }
  }
  await saveCursor(tables, "terminal-reservations", page.rows.length === PAGE_SIZE ? String(page.rows.at(-1)?.$id) : undefined, now);
  return removed;
}

export async function runMaintenance({ tables, storage, now = new Date(), log = () => undefined }) {
  const startedAt = Date.now();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const runId = randomUUID();
  const withinBudget = () => Date.now() - startedAt < WORK_BUDGET_MS;
  if (!await acquireLease(tables, nowMs, runId)) return { status: "skipped-overlap" };
  try {
    const result = {};
    result.retention = await retentionStage({ tables, storage, now: nowIso, cutoff: retainedReceiptCutoff(now), withinBudget });
    if (withinBudget()) result.reservations = await staleReservationStage({ tables, storage, now: nowIso, withinBudget });
    if (withinBudget()) result.orphans = await orphanStage({ tables, storage, nowMs, now: nowIso, withinBudget });
    if (withinBudget()) result.quota = await quotaStage({ tables, now: nowIso });
    if (withinBudget()) result.terminalReservations = await terminalReservationStage({ tables, nowMs, now: nowIso });
    if (result.quota?.projectBytes >= WARNING_BYTES) log(`Receipt project usage warning: ${result.quota.projectBytes} bytes.`);
    return { status: "completed", cutoff: retainedReceiptCutoff(now), elapsedMs: Date.now() - startedAt, ...result };
  } finally {
    await releaseLease(tables, runId);
  }
}

async function maintenanceEntrypoint({ req, res, log, error }) {
  try {
    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
    const apiKey = req.headers["x-appwrite-key"];
    if (!endpoint || !projectId || !apiKey) throw new Error("The maintenance runtime is missing its injected Appwrite identity.");
    const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
    const result = await runMaintenance({ tables: new TablesDB(client), storage: new Storage(client), log });
    return res.json(result);
  } catch (failure) {
    error(failure instanceof Error ? failure.message : "Maintenance failed.");
    return res.json({ status: "failed" }, 500);
  }
}

export default maintenanceEntrypoint;
