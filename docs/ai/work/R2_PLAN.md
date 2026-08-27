# R2 Plan - Trusted Household Command Core (13D + 13E + 13F)

**Status:** COMPLETE and checkpointed at `9ecd4d3` on 2026-08-27. Baseline: R1 checkpoint `5fed47f`. R3 was subsequently authorized; R4 remains unauthorized.

## Implementation progress (2026-08-26)

- **Planning checkpoint:** `07afb82` ("docs: plan R2 trusted command foundation").
- **Gate A PASSED (live provider spike):** provider-assigned transaction ids; read-your-own-writes confirmed; outside readers cannot see staged writes; commit/rollback semantics confirmed; concurrent conflicting commit → **409 `transaction_conflict`**; unique-index violation surfaces at commit as the same 409; TTL range 60–3600 s; expired handle → **410 `transaction_expired`** on staged ops and commit; operation limit = exactly **100**, enforced fail-fast at staging. Zero leftover spike rows/transactions.
- **Schema v2 APPLIED (Gate B approved):** five additive optional columns via existing readiness-barrier applier; post-apply plan clean (`CREATE=0 DRIFT=0 ERRORS=0`); live `schema_metadata.active.version = 2`.
- **Schema V3 APPLIED AND CLEAN (2026-08-27):** `households.name` was widened in place from 64 to 16,383 after an external rows backup and SHA-256 verification. The planner normalizes Appwrite enum columns from `type=string`, `format=enum`, and exact ordered `elements`; all 11 existing enum columns compare as already correct and remain mutation-ineligible. The post-apply plan reports zero creates, safe widenings, drift, provisioning, or errors and live metadata version 3. This is provider capacity, not a Household-name product maximum.
- **R2b command kernel IMPLEMENTED:** `tx-runner.server.ts` (TTL 60 s, single expired-retry, conflict/limit classification), `guards.server.ts` (identity-verified acquire/release/transfer), `command-persistence.server.ts` (atomic household/JR persistence incl. idempotency outcomes + SHA-256 intents), CommandOutcome read repository, ten command routes under `/api/app/household-*`, server compact IDs within provider row-id constraints, BigInt-safe transport reuse.
- **deleteHousehold staged operations (reconciled 2026-08-26, derived from implementation):** household tombstone update 1 · membership updates M · active-membership guard releases M · leader-guard release 1 · financial-guard release 1 · JR closures 3J (update + guard release + closure audit each) · household audit 1 · idempotency outcome 1 (enveloped production delivery) ⇒ **total = 5 + 2M + 3J**. Feasible states under `M + J ≤ 4`, `M ≥ 1`: M=4/J=0 → 13 · M=3/J=1 → 14 (measured, asserted) · M=2/J=2 → 15 · **M=1/J=3 → 16 = true maximum**. Comfortably below the 100-op ceiling; a bound-failure test hard-stops past 100.
- **Idempotency matrix (preferred rule adopted): ALL TEN external mutations ledger** via the request-scoped command envelope — create-household / request-join / cancel / accept / reject / leave / remove-member / transfer-leadership / rename / delete-household. Creates replay the original resource id; transitions/destructive commands replay sanitized success with zero duplicate lifecycle effects; changed-intent reuse → `IDEMPOTENCY_KEY_REUSED`; post-409 re-read converts "first execution actually committed" into a replay. Local composition never opens an envelope and performs zero outcome writes (test-verified).
- **Backup tooling live-smoked:** export + SHA-256 manifest + verify round-trip green against the real project; artifacts land in `APPWRITE_BACKUP_DIR` (default outside repo). Rows-only scope documented.
- **Gate C SIMPLIFIED BY OWNER (2026-08-26): NOT BLOCKED ON A SECOND PROJECT.** The existing Appwrite project is the single production backend and its business tables were verified empty. No `.env.gate-c.local`, disposable project, or live restore drill is required. Before a controlled destructive test, export rows to `APPWRITE_BACKUP_DIR` and verify the manifest/checksums; use only a temporary empty Household; then run delete + replay + changed-intent probes and confirm cleanup. Restore tooling remains an operational asset with unit/stub coverage, while a live restore drill is deferred. Storage binaries remain excluded from the rows-only backup contract.
- **Real two-account journey PASSED:** User 1 created the Household and remained Leader after reload; User 2 requested access and remained Pending after reload; User 1 accepted; User 2 reloaded as active Member. Sanitized live verification reports one active Household, two active memberships, exactly one Leader and one Member, one accepted request, zero pending requests, zero duplicate active memberships, and zero duplicate requests. Command outcomes and audit events each contain exactly the expected Create, Request, and Accept lifecycle entries.
- **R2 gates CLOSED:** restore-script TypeScript, Schema V3, external backup verification, ten-route browser transport, Household-only capability, lost-response/changed-intent checks, focused R2 68/68, full Vitest 640/640 across 80 files, architecture 16/16 plus Appwrite boundaries 12/12, ESLint, TypeScript, production build, zero-vulnerability audit, diff-check, 53-file client-secret scan, Chromium/Firefox/WebKit smoke, Axe, and the real journey are green. Controlled destructive testing was not repeated after the accepted journey; the owner removed a live restore drill as an R2 blocker and the existing project now contains meaningful R2 acceptance history.

## Owner decisions recorded (2026-08-26)

- **D1 Profile commands:** OUT of R2. No dormant production write APIs; Profile bootstrap/read only; Auth email authoritative.
- **D2 Backups:** artifacts MUST live outside Git — configurable `APPWRITE_BACKUP_DIR` with a safe default outside the repository (never beneath tracked project dirs). Cadence/runbook: monthly while active, before schema migrations, before destructive production operations (e.g., Household deletion), before major backend upgrades. Tooling: export + manifest + row counts + SHA-256 checksums + verify + restore + post-restore verification. R2 backup covers **database rows/schema metadata only — NOT Storage receipt binaries** (binaries remain an explicitly documented R4 gap until the storage slice defines its own backup story).
- **D3 Destructive drills (superseded 2026-08-26):** the owner explicitly removed the disposable-project requirement and authorized controlled testing on the existing empty project after backup+manifest verification. Only a temporary empty Household may be deleted; do not run destructive drills after meaningful financial data exists.
- **Capability granularity:** single `householdMutations` flag retained because all ten commands ship and go green together; split into granular keys first if scope ever lands partially.
- **Deletion re-certification rule:** the `M + J ≤ 4` deletion proof depends on the maximum-four-account environment; any later account-limit or self-registration change REQUIRES re-certifying the transaction sizing — never silently retain the 15-operation figure under a larger user model.


## Objective

At R2 exit, an authenticated production user can perform the complete Household lifecycle through the existing frozen UI on Appwrite: Create Household, request/cancel Join Request, Leader Accept/Reject, view active Household, Leave, Remove Member, Transfer Leadership, Delete Household — subject to every frozen financial/membership gate, with trusted server time, coordination guards, cross-device OCC, and retry-safe idempotency. Production Expense/Settlement/Card/Receipt mutations remain unavailable (R3/R4).

## Exact scope

In: trusted command boundary; server-authoritative time; coordination-guard engine over `coordination_guards`; OCC contracts for households/memberships/join requests; idempotent protected-create/outcome ledger over `command_outcomes`; four-member cap enforcement (`HOUSEHOLD_MEMBER_LIMIT_REACHED`); join-request lifecycle under the frozen bound; household rename; atomic household deletion math; backup/restore tooling + restore drill; granular-safe capability enablement; adversarial/local/live test matrix.

Excluded (R3/R4+): expense create/edit/delete, settlement lifecycle, card CRUD, receipt upload/delete/content reads, profile mutations, retention worker (13K). **Profile commands are OUT of R2 scope**: the existing product has no profile-edit UI (Profile page is read-only display), and the frozen rule makes Auth email non-editable; the unused atomic `updateCurrentProfile` port stays dormant until a UI decision exists.

## A. Trusted command boundary

Browser intent → same-origin `POST /api/app/<command>` Route Handler (runCommandCommand wrapper: origin check, Zod body, no-store) → HttpOnly `hft_session` cookie → server-derived actor (`resolveTrustedActor`, allowlist re-checked, never from payload) → authoritative server Clock injected as `ApplicationValues.now()` → unchanged application/domain policy (`HouseholdApplicationService.*`) → Appwrite transaction adapter replacing the R1 read-plane placeholder in `AtomicApplicationPersistence`. Client-supplied `actorId/role/membership/timestamp` fields are rejected structurally (Zod strips/ignores unknown keys; handlers derive everything else server-side). CommandId arrives from the client as an opaque correlation token only (intent binding is server-hashed).

## B. Server-authoritative time

All created/resolved/left/archived/audit instants are produced server-side by the injected Clock as canonical `YYYY-MM-DDTHH:mm:ss.sssZ`. Asia/Dhaka authority remains where the frozen H1 rule requires it (expense business date, R3+; household lifecycle needs only instants). Client timestamps are never accepted.

## C. Coordination guards

Reuse `coordination_guards` with 13A-derived identities (`guardRowId` prefix + truncated SHA-256; full logical key stored and verified via `assertGuardIdentity`):

- `active-membership:<userId>` — one active membership per user; created in accept/createHousehold tx, deleted in leave/remove/delete tx.
- `active-leader:<householdId>` (`ownerValue`=leader userId) — exactly one leader; created on createHousehold, swapped atomically (delete old + create new) in transfer tx, deleted in deletion.
- `pending-join:<userId>` — at most one Pending request per user; created on requestToJoin, deleted on any terminal transition.
- `financial:<householdId>` — serialization counter touched only where the frozen deletion math requires ("participation 2"); expense/settlement writers (R3+) increment it.

Guard conflicts surface as typed conflicts (unique index on `logical_key_unique`). Early verification spike (see Risks) must confirm: unique violations inside an uncommitted transaction surface deterministically at stage/commit; commit behavior when an underlying guarded row changed concurrently; transaction op-count ceiling (plan assumption: 100).

## D. OCC

Version-bearing aggregates: `households.version`, `memberships.version`, `profiles.version` (+ `expenses.revision` in R3). Contract: within one Appwrite transaction, re-read current row via `transactionId`-scoped reads, compare caller-supplied expected `version` (or freshly-read version for actor-initiated flows), reject drift with typed errors (`HOUSEHOLD_STATE_CHANGED` / `CONFLICT`) and roll back — stale changes are never silently merged or overwritten. If the provider additionally rejects conflicting commits (spike-dependent), both layers compose defensively. Read-modify-write loops always occur inside the same transaction so staged-but-uncommitted writes are visible to their own checks.

## E. Idempotency

Approved model: `{actorId, commandType, commandId}` outcome key with server-computed SHA-256 canonical-intent digest. Flow: compute descriptor → lookup `command_outcomes` (derived `commandOutcomeRowId`) → hit + matching digest ⇒ replay stored `resourceId` (idempotent success, no second write); hit + mismatched digest ⇒ `IDEMPOTENCY_KEY_REUSED`; miss ⇒ append outcome row inside the SAME transaction as mutation + audit. Concurrent duplicates collide on the unique index mid-flight → surfaced as `IDEMPOTENCY_IN_PROGRESS` (client retains its commandId and retries safely).

## F. Four-member enforcement

Frozen envelope `MAX_ACTIVE_HOUSEHOLD_MEMBERS = 4`, Leader included, former members excluded from the count. Enforced authoritatively inside the accept/createHousehold transaction: active-membership count query (`by_household_status`) plus the per-user active-membership guard; breach yields stable `HOUSEHOLD_MEMBER_LIMIT_REACHED` (additive application code) with full rollback.

## G. Join Request bound

Exactly as frozen in PHASE_13_PLAN Decision C: **no pending-request cap; under the four-account envelope `M + J ≤ 4`**, where M = active memberships (≥1 Leader) and J = Pending join requests. No additional cap is introduced; the bound falls out of account scarcity plus the per-user pending-join guard.

## H. Household deletion

Semantics preserved verbatim: requires exact zero balances and no Pending settlements; tombstones the household; converts active memberships to former (retaining last role/history); closes Pending Join Requests as `household-closed`; retains ALL financial history, audits, receipts metadata, and private Cards (absent from the write set). The implemented, enveloped delivery formula is **operations = 5 + 2M + 3J**: Household tombstone 1 + membership updates M + membership-guard releases M + leader-guard release 1 + financial-guard release 1 + Join Request closure/guard/audit triplets 3J + Household audit 1 + command outcome 1. Worst feasible states under `M+J≤4`: M=4,J=0 → **13 ops**; M=1,J=3 → **16 ops**. Both sit far below the Free-plan verified limit of **100 staged operations per transaction**.

## I. Backup / restore

Delivered inside R2 before destructive commands go live. `scripts/appwrite-backup.mts`: page-through export of all 14 tables → timestamped JSON under `APPWRITE_BACKUP_DIR` (safe default outside the repository; never beneath tracked dirs) + per-table row counts + combined SHA-256 manifest. Scope: **database rows + schema metadata only — receipt Storage binaries are NOT included** (documented R4 gap). `scripts/appwrite-restore.mts` remains fail-closed operational tooling. Per the superseding owner decision, R2 requires a live backup export and checksum/manifest verification before the controlled empty-Household delete proof; a backup→restore drill into a second project is deferred and no longer blocks R2.

## J. Capability enablement sequence

Production now reports `householdMutations=true` for the complete ten-command R2 family. Receipt, expense, settlement, card, receipt-content, and profile mutation flags remain false. If future scope ever lands partially, split the capability key first rather than enabling an incomplete family.

## K. UI reuse

Zero Household UI changes. Forms/dialogs/menus already invoke runtime actions; the production browser transport replaces `commandUnavailable()` per action with real endpoint calls as each lands. Onboarding, request queue, member management, leave/remove/transfer/delete confirmations are reused verbatim.

## Command endpoint inventory (all same-origin POST unless noted)

| Endpoint | Wraps | Idempotent |
|---|---|---|
| `/api/app/household-create` | createHousehold(name, code) | yes |
| `/api/app/household-request-join` | requestToJoin(householdId) | yes |
| `/api/app/household-cancel-request` | cancelJoinRequest(id) | transition (guarded) |
| `/api/app/household-accept-request` | acceptJoinRequest(id) | transition (guarded) |
| `/api/app/household-reject-request` | rejectJoinRequest(id) | transition (guarded) |
| `/api/app/household-leave` | leaveCurrentHousehold() | transition (guarded) |
| `/api/app/household-remove-member` | removeMember(userId) | transition (guarded) |
| `/api/app/household-transfer-leadership` | transferLeadership(userId) | transition (guarded) |
| `/api/app/household-rename` | renameHousehold(name) | guarded no-op safe |
| `/api/app/household-delete` | deleteCurrentHousehold() | guarded destructive |

Reads (`lookup`, `code-candidate`, `access`) already exist from R1.

## Error model

Existing sanitized mapping (401/403/404/409/429/503) extends with: `HOUSEHOLD_MEMBER_LIMIT_REACHED` → 409 with stable user copy; `HOUSEHOLD_CODE_GENERATION_EXHAUSTED` → 409; guard/OCC drift → 409 with reload-and-review copy; idempotency codes per E. Raw provider errors never leave the server; unexpected failures log server-side and return the generic 503 envelope. Every command response returns either `{data}` or `{error}` — never partial state claims; clients reconstruct authoritative state via existing bootstrap/access reads after mutation (mirroring local mutateAndReconstruct semantics).

## Security / adversarial test matrix

Forged actor/userId payloads ignored · wrong-household identifiers → NOT_FOUND · member performing Leader action → NOT_FOUND · former-member actions rejected · stale role/membership (precheck-passes-commit-fails) rolled back · duplicate Join Request blocked (guard) · fifth active member blocked (cap) · concurrent accept vs cap · concurrent leadership transfer (one winner) · deletion racing membership change · arbitrary client timestamps stripped/rejected · replayed commandId idempotently returns original resource · reused commandId with changed intent → IDEMPOTENCY_KEY_REUSED · cross-household probing enumeration-safe · anonymous → 401 · throttled house-code lookups unchanged. Implemented at three layers: pure/application (existing suites), tx-stub integration (new command adapters vs InMemoryTablesReader + fake-indexeddb parity harness extension), and route-level tests.

## Local contract tests

Extend the R1 parameterized parity harness from reads to commands: identical seeded scenarios executed through local IndexedDB atomic adapters and Appwrite tx-stub adapters must yield identical resulting projections (access state, member lists, request queues, audit trails) and identical typed failure sets across the whole matrix above.

## Live Appwrite tests (authorization-gated window)

Controlled, no seeded fake users — approved accounts only: Account A logs in → Create Household; Account B logs in → request Join; A accepts; both reconstruct correct roles; reload/new-tab persistence proven; then a bounded destructive drill (leave/remove/rename/second-household-delete cycle) executed on the REAL project only if the owner accepts the residual risk — otherwise on a disposable second Appwrite project (open decision D3). Deferred authenticated first-login smoke can piggyback on this same window.

## Expected file / schema changes

New: `src/infrastructure/appwrite/runtime/command-context.server.ts` (tx runner, guard engine, OCC helpers, idempotency ledger), `runtime/product-commands.server.ts`, `runtime/read-route.server.ts` sibling `runTrustedCommand`, **ten** thin command routes (household-create, request-join, cancel-request, accept-request, reject-request, leave, remove-member, transfer-leadership, rename, delete), `src/application/errors` additive codes, `scripts/appwrite-backup.mts` / `appwrite-restore.mts`, `.gitignore` backup entry. Modified: `AtomicApplicationPersistence` adapter wiring (placeholder replaced), definitions/mappers for schema v2, capability constants, architecture guards (allow-list new routes; assert command modules server-only; extend composition separation), transport + provider signOut-style action wiring, docs. Schema v2 (additive only, planner-managed): `expenses.deletedByUserId`, `households.deletedByUserId`, `join_requests.resolvedByUserId`, `receipt_metadata.contentRemovedByUserId`, `receipt_metadata.originalFilename` — closing the four fail-closed gaps discovered by R1 mappers; `schema_metadata.active.version → 2`.

## Cloud-resource changes

Additive columns on four existing tables + schema-metadata version row update via the existing dry-run-first applier. No new databases, tables, indexes (none of the new columns are queried as filters), buckets, functions, or keys.

## Risks / open decisions

R1-spike (blocking, first task): live-verify Appwrite transaction semantics — commit-time conflict detection vs last-write-wins on concurrent underlying-row change, unique-index surfacing point, TTL behavior, op-count ceiling. D1: profile-edit UI absence — confirm Profile commands stay out indefinitely until designed. D2: backup storage location/schedule on owner machine (path outside Git; monthly cadence per plan). D3: destructive live drills on real project vs disposable second project (Free-tier project-count headroom must be checked). R2: transaction TTL expiry mid-flow handling (bounded staging, immediate commit attempt, client-safe retry). R3: renameHousehold no-op suppression must not double-append audits under retries (covered by idempotency digest including name).

## Recommended implementation slices / order

- **R2a** (foundation): transaction/guard/OCC live spike; schema v2 then approved Schema V3 apply (dry-run first); backup/verify tooling; additive error codes. Complete, including the restore-script TypeScript correction and the owner-approved existing-project backup workflow.
- **R2b** (kernel): tx-backed `AtomicApplicationPersistence` adapter for household/membership/JR operations; idempotency ledger; guard engine; local contract + race matrix suites green.
- **R2c** (surface): **ten** command endpoints + transport wiring; route/security tests; capability flip behind full-matrix green.
- **R2d** (acceptance): live two-account scenario (+ deferred first-login smoke), docs reconciliation, uncommitted-for-review handoff.

Recommended reasoning level: **High** (security, concurrency, provider-semantics risk — consistent with the roadmap's Phase 13 rating).
