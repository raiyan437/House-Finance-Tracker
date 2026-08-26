# R2 Plan - Trusted Household Command Core (13D + 13E + 13F)

**Status:** Approved for implementation 2026-08-26 (R3/R4 remain unauthorized). Baseline: R1 checkpoint `5fed47f`.

## Owner decisions recorded (2026-08-26)

- **D1 Profile commands:** OUT of R2. No dormant production write APIs; Profile bootstrap/read only; Auth email authoritative.
- **D2 Backups:** artifacts MUST live outside Git — configurable `APPWRITE_BACKUP_DIR` with a safe default outside the repository (never beneath tracked project dirs). Cadence/runbook: monthly while active, before schema migrations, before destructive production operations (e.g., Household deletion), before major backend upgrades. Tooling: export + manifest + row counts + SHA-256 checksums + verify + restore + post-restore verification. R2 backup covers **database rows/schema metadata only — NOT Storage receipt binaries** (binaries remain an explicitly documented R4 gap until the storage slice defines its own backup story).
- **D3 Destructive drills:** disposable second Appwrite project preferred; if unavailable → STOP and report before any real-project substitution; a real-project destructive drill would need separate explicit authorization and is only conceivable before meaningful business data exists.
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

Semantics preserved verbatim: requires exact zero balances and no Pending settlements; tombstones the household; converts active memberships to former (retaining last role/history); closes Pending Join Requests as `household-closed`; retains ALL financial history, audits, receipts metadata, and private Cards (absent from the write set). Single atomic Appwrite transaction using the approved frozen formula **operations = 4 + 2M + 3J** (tombstone 1 + membership updates M + membership-guard deletes M + leader-guard delete 1 + JR closures J + JR-guard deletes J + closure audits J + household audit 1 + financial-guard participation 2). Worst feasible states under `M+J≤4`: M=4,J=0 → **12 ops**; M=1,J=3 → **15 ops**. Both sit far below the Free-plan verified limit of **100 staged operations per transaction**.

## I. Backup / restore

Delivered inside R2 before destructive commands go live. `scripts/appwrite-backup.mts`: page-through export of all 14 tables → timestamped JSON under `APPWRITE_BACKUP_DIR` (safe default outside the repository; never beneath tracked dirs) + per-table row counts + combined SHA-256 manifest. Scope: **database rows + schema metadata only — receipt Storage binaries are NOT included** (documented R4 gap). `scripts/appwrite-restore.mts`: verify mode (recompute checksums, report drift) and restore mode targeting an explicit destination database id — never destructive against the live id without an explicit `--yes <target>` pair. Restore DRILL (backup → restore into scratch target → post-restore verification) is an R2 exit prerequisite and runs on the disposable second project per D3.

## J. Capability enablement sequence

R1 reports `householdMutations=false`. The single flag flips to true only when EVERY command it covers (create, find/lookup stays read, requestToJoin, cancel/accept/reject, leave, removeMember, transferLeadership, renameHousehold, deleteHousehold) is implemented, contract-tested, and adversarially green together — they ship as one slice, so granularity is unnecessary; if scope is ever split, split the capability key first rather than flipping partially. Receipt/expense/settlement/card flags stay false.

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

- **R2a** (foundation): transaction/guard/OCC live spike; schema v2 apply (dry-run first); backup/restore tooling + drill; additive error codes.
- **R2b** (kernel): tx-backed `AtomicApplicationPersistence` adapter for household/membership/JR operations; idempotency ledger; guard engine; local contract + race matrix suites green.
- **R2c** (surface): **ten** command endpoints + transport wiring; route/security tests; capability flip behind full-matrix green.
- **R2d** (acceptance): live two-account scenario (+ deferred first-login smoke), docs reconciliation, uncommitted-for-review handoff.

Recommended reasoning level: **High** (security, concurrency, provider-semantics risk — consistent with the roadmap's Phase 13 rating).
