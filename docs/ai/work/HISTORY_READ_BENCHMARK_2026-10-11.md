# History-read measurements — 2026-10-11

## Reproduce

Run `npm run benchmark:history` from the repository root after installing its existing development dependencies. No credentials, environment files, browser server, paid service, production requests, or user records are used. The `react-server` condition permits the existing server-only modules to run in this isolated Node harness. It does not expose those modules to a browser.

The harness uses the real application services, IndexedDB repositories/mappers/schema over process-local fake IndexedDB, and Appwrite read repositories/mappers/100-row pagination over the existing in-memory TablesDB stand-in. The temporary local database is named `hft-history-benchmark-<pid>-<expense count>` and closed/deleted after each scenario. Application commands/ID generation throw, and the provider object only exposes read methods.

Each scenario has four active members, 180 Expenses/year (15/month), dates ending August 2026, one-third Card payments, 5% retained deleted Expenses, a comment on every tenth Expense, and one resolved Settlement/month split between Confirmed and Cancelled. Amounts/shares remain exact integer poisha. Expense history includes deleted rows. Receipt binaries, comments with multiple replies, changing membership, cold starts and larger households are outside this timing fixture; existing integration/browser tests cover their correctness separately.

Each adapter/operation gets two discarded warmups and nine measured samples. The median is sample 5; the reported nearest-rank p95 is the maximum of these nine samples, not a robust production percentile. Output serialization/parity checking is outside the timing window; end-to-end invariant assertions are inside it. A paired projection-only measurement excludes storage, assertions and serialization, and includes index construction. Do not run other builds/tests during measurements.

Every sample checks local/provider output parity, complete history, exact allocation sums, zero-sum Dashboard balances, monthly spending, owner-only private Card snapshots, deterministic provider request/row counts and 100-row maximum pages. Results are written to stdout as JSON with the host environment and limitations.

## Measured change

The first end-to-end run exposed repeated validation/scanning of identical Settlement history for every Expense projection: both `latestConfirmedSettlementAt` and `latestConfirmedSettlementBefore` traversed it again for each row. Expense-history time grew much faster than Dashboard time as both Expenses and Settlements accumulated.

`indexConfirmedSettlementHistory` now validates the whole read snapshot once, including irrelevant household/status rows, retains the first Settlement when timestamps tie, and indexes confirmation instants. Expense list projections reuse its latest confirmation and a binary-search strict-before boundary. The context lives only within that list request; individual reads and mutation authorization/revalidation retain the original scans. No cache, persisted aggregate, provider query change, transaction change, or weaker validation was introduced. Empty lists still do not validate an unused Settlement snapshot.

New parity tests compare the index against the original boundary functions for ordering, ties, equality, missing confirmations, malformed/unrelated rows and invalid instants. Projection parity includes deleted/former/legacy-percentage history, locks, backdated warnings and owner-only Cards. The harness also compares every indexed projection with the preserved individual-scan path at all three sizes.

## Results

Environment: Windows x64, Node `v24.19.0`, AMD Ryzen 5 3600, Asia/Dhaka; no concurrent build/test during this final run. CI uses Node 22; these numbers are local measurements, not hosted-CI or production timings. Full aggregate output is preserved in [history-read-benchmark-2026-10-11.json](history-read-benchmark-2026-10-11.json).

Paired projection CPU (median / sample p95 in ms):

| History | Expenses / Settlements | Original scans | Request-local index | Median speedup |
| --- | --- | --- | --- | --- |
| 1 year | 180 / 12 | 16.58 / 16.93 | 3.24 / 7.42 | 5.1× |
| 5 years | 900 / 60 | 345.68 / 356.34 | 14.78 / 16.29 | 23.4× |
| 10 years | 1,800 / 120 | 1,338.62 / 1,353.18 | 30.53 / 32.43 | 43.8× |

Final end-to-end paths (median / sample p95 in ms), including storage stand-ins, actual row validation/paging and application projection:

| History | Operation | IndexedDB | Appwrite memory | Provider requests / returned rows |
| --- | --- | --- | --- | --- |
| 1 year | Dashboard | 7.75 / 9.39 | 91.72 / 102.65 | 10 / 202 |
| 1 year | Monthly Report | 7.27 / 12.73 | 87.41 / 89.44 | 10 / 202 |
| 1 year | Settlements | 6.61 / 12.04 | 85.94 / 93.74 | 9 / 201 |
| 1 year | Expense history | 9.97 / 14.08 | 95.04 / 102.64 | 21 / 230 |
| 5 years | Dashboard | 31.71 / 33.17 | 418.58 / 459.35 | 18 / 970 |
| 5 years | Monthly Report | 30.61 / 32.03 | 407.49 / 415.42 | 18 / 970 |
| 5 years | Settlements | 30.15 / 34.64 | 409.93 / 414.55 | 17 / 969 |
| 5 years | Expense history | 47.39 / 51.37 | 452.09 / 459.90 | 89 / 1,130 |
| 10 years | Dashboard | 62.90 / 69.89 | 821.57 / 880.67 | 28 / 1,930 |
| 10 years | Monthly Report | 62.36 / 66.50 | 823.20 / 862.09 | 28 / 1,930 |
| 10 years | Settlements | 57.35 / 60.01 | 816.85 / 827.48 | 27 / 1,929 |
| 10 years | Expense history | 94.55 / 98.72 | 919.51 / 962.55 | 175 / 2,255 |

All counts were identical across warmups/samples; all financial/privacy/output assertions passed. Exact multiples of the 100-row page size require an extra empty page to establish completeness, so 1,800 Expenses take 19 requests.

Decision: retain the measured request-local index. At 10 years, it removes about 97.7% of the original projection CPU work without changing returned data. This is a projection-only comparison, not a 43.8× production page-speed claim. Do not add speculative caches or persisted balances. Provider mapping still validates every row; this harness does not isolate mapping/schema-construction CPU from the memory provider's filtering cost. At 10 years, 150 of the 175 Expense-history requests read owner-private Card snapshots individually. A future owner-scoped bulk-read proposal should preserve household authorization, owner/creator checks and stale-read semantics, and should be driven by measured real-provider latency/server limits before implementation. No provider query or privacy boundary was changed here.

## Separate financial-safety finding: 5,000-row cap

An independent synthetic reproduction supplied 5,001 matching rows to the real provider reader. It returned 5,000 without an error: the loop stops at the cap, while the later guard only rejects a count greater than the cap. This can silently omit financial history if the frozen volume envelope is exceeded. The benchmark scenarios stay below that cap; the observation is not a live-provider or production-data claim.

Recommended resolution: detect another matching row when the cap is reached and reject the read with `PERSISTENCE_FAILURE` before producing balances/recommendations, with tests for 4,999, exactly 5,000, and 5,001 rows. Do not substitute a partial ledger or silently enlarge the envelope. This changes overflow behavior and therefore requires owner approval under [PROJECT_RULES.md](../PROJECT_RULES.md) and the supplied AGENTS.md rule: “stop before inventing behavior, document the impact, recommend a resolution, and obtain approval when product behavior would change.” No overflow behavior was changed in P4.

## Browser/CI evidence

P3's final local aggregate run passed 78 cases with one explicit Windows WebKit Receipt persistence skip. A separate direct IndexedDB Blob probe reproduced `UnknownError: Error preparing Blob/File data to be stored in object store` in Windows WebKit; Firefox passed the same probe. A receipt-free percentage journey still runs there. The Linux CI job selects 79 cases (49 Chromium, 15 Firefox, 15 WebKit), including the Receipt journey; hosted CI remains pending until a future authorized push. Clipboard payload fixtures cover engines lacking Chromium's clipboard permission controls, with native clipboard coverage retained in Chromium.
