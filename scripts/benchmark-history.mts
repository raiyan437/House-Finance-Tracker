import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { cpus } from "node:os";
import type { TablesDB } from "node-appwrite";
import {
  HouseFinanceApplication,
  type ApplicationValues,
} from "../src/application/services/application-services";
import type {
  ApplicationRepositories,
  AtomicApplicationPersistence,
} from "../src/application/repositories";
import {
  calendarMonth,
  localCalendarMonthFromInstant,
} from "../src/application/analytics/calendar-month";
import { serializeWithBigInt } from "../src/application/transport/json-bigint";
import { IndexedDbRepositories } from "../src/infrastructure/indexeddb/repositories";
import { createAppwriteReadRepositories } from "../src/infrastructure/appwrite/reads/read-repositories.server";
import { createTablesReader } from "../src/infrastructure/appwrite/reads/tables.server";
import { createInMemoryTablesDB } from "../src/infrastructure/appwrite/reads/in-memory-tables-reader.helper";
import { SEEDED_USER_IDS } from "../src/infrastructure/indexeddb/seed";
import { isoInstant } from "../src/domain/shared/instant";
import {
  historyFixture,
  localHistory,
  providerHistory,
} from "./history-benchmark-fixture.mjs";
import { projectExpenseView } from "../src/application/services/expense-projection";
import { indexConfirmedSettlementHistory } from "../src/domain/expenses/confirmed-settlement-history";

const SAMPLES = 9;
const WARMUPS = 2;
const MONTH = calendarMonth("2026-08");
const ACTOR = SEEDED_USER_IDS.raiyan;
const values: ApplicationValues = {
  now: () => isoInstant("2026-09-13T12:00:00.000Z"),
  nextId: () => {
    throw new Error("The benchmark cannot generate writes.");
  },
  nextHouseholdCodeCandidate: () => {
    throw new Error("The benchmark cannot generate writes.");
  },
};
const atomic = new Proxy({} as AtomicApplicationPersistence, {
  get: () => () => {
    throw new Error("The benchmark cannot issue commands.");
  },
});
function application(repositories: ApplicationRepositories) {
  return new HouseFinanceApplication({
    repositories,
    atomic,
    values,
    session: {
      getCurrentUserId: async () => ACTOR,
      subscribe: () => () => undefined,
    },
  });
}

interface Traffic {
  requests: number;
  rows: number;
  maxPageRows: number;
  byTable: Record<string, { requests: number; rows: number }>;
}
const emptyTraffic = (): Traffic => ({
  requests: 0,
  rows: 0,
  maxPageRows: 0,
  byTable: {},
});
function meteredProvider(fixture: ReturnType<typeof historyFixture>) {
  const { tablesDB } = createInMemoryTablesDB(providerHistory(fixture));
  let traffic = emptyTraffic();
  const readOnly = {
    async getRow(input: Parameters<typeof tablesDB.getRow>[0]) {
      const row = await tablesDB.getRow(input);
      record(input.tableId, row ? 1 : 0);
      return row;
    },
    async listRows(input: Parameters<typeof tablesDB.listRows>[0]) {
      const page = await tablesDB.listRows(input);
      record(input.tableId, page.rows.length);
      traffic.maxPageRows = Math.max(traffic.maxPageRows, page.rows.length);
      return page;
    },
  };
  function record(table: string, rows: number) {
    traffic.requests += 1;
    traffic.rows += rows;
    const previous = traffic.byTable[table] ?? { requests: 0, rows: 0 };
    traffic.byTable[table] = {
      requests: previous.requests + 1,
      rows: previous.rows + rows,
    };
  }
  // Real provider paging and row validation, backed exclusively by synthetic memory.
  const repositories = createAppwriteReadRepositories(
    createTablesReader(readOnly as unknown as TablesDB),
    ACTOR,
    "benchmark@local.test",
  );
  return {
    app: application(repositories),
    reset: () => {
      traffic = emptyTraffic();
    },
    traffic: () => structuredClone(traffic),
  };
}

type Operation = (app: HouseFinanceApplication) => Promise<unknown>;
function operations(
  fixture: ReturnType<typeof historyFixture>,
): Record<string, Operation> {
  const household = fixture.household.householdId;
  return {
    dashboard: async (app) => {
      const view = await app.analytics.getDashboard(household, MONTH);
      assert.equal(
        view.housemateBalances.reduce(
          (sum, member) => sum + BigInt(member.balance),
          BigInt(0),
        ),
        BigInt(0),
        "Balances must stay zero-sum.",
      );
      assert.equal(BigInt(view.spent), monthlyTotal(fixture));
      return view;
    },
    monthlyReport: async (app) => {
      const view = await app.analytics.getMonthlyReport(
        household,
        MONTH,
        localCalendarMonthFromInstant,
      );
      assert.equal(BigInt(view.totalSpending), monthlyTotal(fixture));
      return view;
    },
    settlements: (app) => app.settlements.getSettlementPage(household),
    expenseHistory: async (app) => {
      const views = await app.expenses.listHouseholdExpenses(household, true);
      assert.equal(
        views.length,
        fixture.expenses.length,
        "Retained history must be complete.",
      );
      for (const view of views) {
        assert.equal(
          view.expense.allocations.reduce(
            (sum, item) => sum + BigInt(item.share),
            BigInt(0),
          ),
          BigInt(view.expense.amount),
        );
        assert.equal(
          Boolean(view.privateCardSnapshot),
          view.expense.creatorId === ACTOR &&
            view.expense.payment.method === "card",
          "Private snapshots remain owner-only.",
        );
      }
      return views;
    },
  };
}
function monthlyTotal(fixture: ReturnType<typeof historyFixture>) {
  return fixture.expenses
    .filter(
      (expense) => !expense.deletedAt && expense.expenseDate.startsWith(MONTH),
    )
    .reduce((sum, expense) => sum + BigInt(expense.amount), BigInt(0));
}
const canonical = (value: unknown) => JSON.parse(serializeWithBigInt(value));
const percentile = (sorted: readonly number[], fraction: number) =>
  Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(2));

const results = [];
for (const years of [1, 5, 10] as const) {
  const fixture = historyFixture(years);
  const local = await localHistory(fixture);
  try {
    const localApp = application(new IndexedDbRepositories(local.db));
    const provider = meteredProvider(fixture);
    for (const [operation, run] of Object.entries(operations(fixture))) {
      const reference = canonical(await run(localApp));
      for (const [adapter, app] of [
        ["indexeddb", localApp],
        ["appwrite-memory", provider.app],
      ] as const) {
        const samples: number[] = [];
        let expectedTraffic: Traffic | undefined;
        for (let sample = -WARMUPS; sample < SAMPLES; sample += 1) {
          provider.reset();
          const start = performance.now();
          const output = await run(app);
          const elapsed = performance.now() - start;
          assert.deepEqual(
            canonical(output),
            reference,
            `${operation} read/projection parity`,
          );
          if (adapter === "appwrite-memory") {
            const traffic = provider.traffic();
            assert.ok(
              traffic.maxPageRows <= 100,
              "Exercise the real provider page size.",
            );
            if (expectedTraffic)
              assert.deepEqual(
                traffic,
                expectedTraffic,
                "Provider traffic must be reproducible.",
              );
            expectedTraffic = traffic;
            assert.equal(
              traffic.byTable.expenses.rows,
              fixture.expenses.length,
              "Every financial row was read.",
            );
          }
          if (sample >= 0) samples.push(elapsed);
        }
        samples.sort((a, b) => a - b);
        results.push({
          years,
          expenses: fixture.expenses.length,
          settlements: fixture.settlements.length,
          comments: fixture.comments.length,
          adapter,
          operation,
          medianMs: percentile(samples, 0.5),
          p95Ms: percentile(samples, 0.95),
          ...(expectedTraffic ? { traffic: expectedTraffic } : {}),
        });
      }
    }
    // Paired CPU isolation, in the same process/fixture: compare the preserved
    // individual-scan path with the indexed path, including index construction.
    const snapshots = new Map(
      fixture.snapshots.map((snapshot) => [snapshot.expenseId, snapshot]),
    );
    const commentCounts = new Map(
      fixture.comments.map((comment) => [comment.expenseId, 1]),
    );
    const project = (indexed: boolean) => {
      const history = indexed
        ? indexConfirmedSettlementHistory(
            fixture.household.householdId,
            fixture.settlements,
          )
        : undefined;
      return fixture.expenses.map((expense) =>
        projectExpenseView(
          expense,
          ACTOR,
          fixture.memberships,
          fixture.settlements,
          expense.creatorId === ACTOR && expense.payment.method === "card"
            ? snapshots.get(expense.expenseId)
            : undefined,
          commentCounts.get(expense.expenseId) ?? 0,
          history,
        ),
      );
    };
    const projectionReference = canonical(project(false));
    for (const indexed of [false, true]) {
      const samples = [];
      for (let sample = -WARMUPS; sample < SAMPLES; sample += 1) {
        const start = performance.now();
        const output = project(indexed);
        const elapsed = performance.now() - start;
        assert.deepEqual(
          canonical(output),
          projectionReference,
          "Indexed projection must match the original boundary scans.",
        );
        if (sample >= 0) samples.push(elapsed);
      }
      samples.sort((a, b) => a - b);
      results.push({
        years,
        expenses: fixture.expenses.length,
        settlements: fixture.settlements.length,
        comments: fixture.comments.length,
        adapter: "projection-cpu",
        operation: indexed ? "indexedProjection" : "originalProjection",
        medianMs: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
      });
    }
  } finally {
    await local.close();
  }
}
console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        samples: SAMPLES,
        warmups: WARMUPS,
        selectedMonth: MONTH,
      },
      limitations:
        "Synthetic in-process provider and fake IndexedDB: includes real repositories, paging, validation and projections; excludes network, provider server time/limits, native browser storage, rendering, cold boot and receipt binaries. End-to-end timings include invariant assertions; parity serialization is outside timing. Projection CPU timings exclude storage, assertions and serialization, and include index construction. No production latency or capacity claim.",
      results,
    },
    null,
    2,
  ),
);
