# Production Release Plan - five gated phases (R1-R5)

**Status:** Owner-directed consolidation created 2026-08-26. This document maps all remaining work — slices 13C through 13M plus roadmap Phases 14-15 — into exactly five releasable phases. It changes no approved decision; where a detail was never decided, it is listed under Open decisions rather than invented. Each phase requires separate owner authorization; completing one phase never authorizes the next. Slice-level detail for R1 lives in `PHASE_13C_PLAN.md`; later phases get their own detailed plan documents before implementation, produced under this umbrella.

## Release definition (what "production release" means here)

All four approved accounts can log in; the single production Household operates the complete frozen Local MVP feature set on Appwrite (expenses, splits, settlements with confirmed-history locks, private cards, receipts with retention); trusted-server protections (server time, OCC, idempotency, throttles, guards) are active; the scheduled retention Function runs; backups exist and were restore-verified; integration/security QA is closed; the app is deployed on zero-cost approved infrastructure with rollback and runbook documentation; the owner has accepted go-live.

## Frozen operating envelope (unchanged)

1 production Household · max 4 active members · max 4 admin-pre-provisioned accounts (`ALLOWED_ACCOUNT_EMAILS` fail-closed) · ~15 Expenses/month · private in-house use · zero additional cost (Appwrite Cloud Free + zero-cost hosting) · Decision D pauses/backups limitations accepted with the documented runbook. No synchronization with local IndexedDB data ever occurs; production starts from empty business tables.

## Entry state (today)

- 13A committed and applied (schema v1, empty business tables). 13B implemented, locally green, **uncommitted**; new-user first-login bootstrap proof explicitly deferred.
- 13C planned (`PHASE_13C_PLAN.md`), awaiting three owner decisions and implementation authorization.
- Architecture guards enforce current boundaries; local composition remains the frozen MVP baseline.

---

## R1 - Production data plane: authenticated product surface (reads)

**Status (2026-08-26): OWNER-APPROVED RELEASE CHECKPOINT.** R1 implementation = COMPLETE; automated/static/live-read verification = COMPLETE (evidence below); **authenticated first-login live smoke = DEFERRED BY OWNER** and must not be represented as passed until actually run. Production business writes are NOT implemented (capability-gated off). Self-registration remains unresolved/deferred. R1 is a release checkpoint, not final production approval; R2 (trusted Household command core) is next.

**Goal:** replace the "Signed in" milestone with the real frozen product UI reading live Appwrite data, so login lands on the Dashboard.

**Includes:** slice **13C** exactly as planned (read repositories + mappers, trusted request context, read-only Route Handler surface, browser production runtime, layout swap, guard amendments, shared local-vs-Appwrite contract suite) **plus**:

- Commit the owner-reviewed 13B tree (requires the still-outstanding commit authorization) and the 13C work on `feature/phase-13-appwrite`.
- Complete the **deferred 13B first-login proof** for the already-provisioned user against the live project: login, idempotent Profile bootstrap, reload/new-tab session restoration, logout with remote revocation (now meaningful because the product surface renders).
- Live read-only smoke checklist from the 13C plan, executed in a dedicated owner-approved window (reads cannot mutate; business tables are empty, so expected result is correct empty/onboarding states).
- Minimal CI quality gate on the repo (lint + typecheck + Vitest + build on push) using free tiers only.

**Entry criteria:** three 13C decisions answered (interim command affordance; server-authoritative Dhaka business date; live-smoke timing); explicit authorization to implement 13C and to commit 13B.

**Exit gates:** 13C exit criteria met (contract parity, no write paths, amended guards, full local matrix green); live first-login matrix passes in Chromium/Firefox/WebKit; built-client secret scan green including new modules; `PROJECT_STATE.md`/`ACTIVE_PLAN.md` updated.

**User-visible result:** login -> Dashboard/shell/Household-onboarding states render from production data; every mutation answers with the agreed honest pending message.

## R2 - Trusted command core: tenancy and identity

**Status (2026-08-26): PLANNING COMPLETE in `R2_PLAN.md`; implementation NOT authorized.** Planning-only output covers the owner-mandated areas A-M: trusted boundary, server time, guard design, OCC, idempotency, member cap, frozen `M + J <= 4` join bound, deletion transaction math (12-15 ops worst-case vs 100 limit), backup/restore with drill prerequisite, single-flag capability flip gated on full-command green, zero UI redesign, adversarial matrix, local parity extension, live two-account acceptance, additive schema v2 columns (the four R1-discovered gaps plus receipt filename), and the blocking provider-transaction semantics spike.

## R2 - Trusted command core: tenancy and identity

**Goal:** make household life possible on production — onboarding, membership management, and profile — on top of the trusted command machinery.

**Includes:** slices **13D** (trusted commands: server Clock instants, ID injection, coordination-guard writes, house-code generation/lookup hardening), **13E** (cross-device OCC semantics and idempotent protected creates over `command_outcomes` + unique indexes), **13F** (household create/rename/leave/remove/leadership-transfer/delete, join-request send/cancel/accept/reject with guard-based uniqueness and member-cap enforcement), and the profile display-name command (atomic `updateCurrentProfile` equivalent with transaction-time uniqueness/OCC). Command Route Handlers extend `/api/app/**` behind the same session boundary; interim pending responses are retired action-by-action.

**Also:** backup/export tooling from PHASE_13_PLAN ("Backup tooling (planned)") with the verify-restore companion, exercised before any financial writes exist (R3 entry prerequisite); signed backdated-confirmation token scheme defined here if its design touches shared command plumbing (its *use* arrives with expenses in R3).

**Entry criteria:** R1 accepted; owner authorizes R2; confirmation that the production Household will be created through the real UI by the owner-designated Leader account.

**Exit gates:** shared contract suites extended to cover every command against both providers (fake-indexeddb vs stubbed/live TablesDB); concurrency proofs (double-submit replays idempotently, stale OCC rejected, guard conflicts safe); deletion math bounded as planned (<=15 staged operations); adversarial authorization tests (member-vs-leader, outsider 404s); full local matrix green; live smoke of the full household lifecycle by two test accounts; docs updated.

**User-visible result:** both existing accounts can form the Household, manage membership and join requests, and edit display names on production.

## R3 - Financial feature commands: expenses, cards, settlements

**Goal:** turn the read-only financial screens into working workflows without weakening a single frozen rule.

**Includes:** slices **13I** (private Card CRUD + archive/delete consent flow), **13G** (Expense create/edit/delete: exact-poisha persistence, future-date/business-date enforcement via server Clock, backdated challenge with server-signed tokens, confirmed-settlement financial lock derived at commit, revision OCC, creator/leader permission rechecks in-transaction, audit events), **13H** (Settlement mark-paid/confirm/reject/cancel: exact-current-recommendation validation, Pending pair uniqueness via guards, immutable terminal history, stale warnings computed fresh). Sequence inside the phase: Cards -> Expenses -> Settlements (card selection depends on Cards; settlement locking depends on Expenses).

**Entry criteria:** R2 accepted **and** its backup tooling proven by a successful verify-restore exercise; owner authorizes R3.

**Exit gates:** property/integration parity for balances, allocations, remainders, basis points between providers; race matrix (concurrent edits, settlement-confirm vs expense-edit, double confirm) proving rollback completeness; privacy probes (leader cannot read private card data anywhere on the wire; non-creator receipt metadata projection opaque); idempotent replay isolation for protected creates; full multi-browser Playwright over intercepted fixtures plus a scripted live two-account scenario (create household members' expenses, settle, confirm, verify locks); docs updated.

**User-visible result:** complete expense/settlement/card workflows live on production with real cross-device concurrency protection.

## R4 - Receipts, retention, and reconciliation

**Goal:** close the binary-content lifecycle end-to-end and automate its upkeep.

**Includes:** slices **13J** (receipt upload through Storage via trusted route with the reservation/upload saga: reservations, quota accounting 10 MiB/file, 3/Expense, 50 MiB/uploader, 1 GB project ceiling, content-before-metadata ordering, failure recovery) and **13K** (deploy the maintenance Function: once-daily Asia/Dhaka cutoff computation at execution time, delete-before-mark conditional retention transitions, already-missing tolerance, bounded deterministic batches, orphan reconciliation pass, verified cron `0 0 * * *` and 300 s timeout, execution locked away from clients). Receipt read proxy from R1 gains upload/delete siblings; quota endpoints go live.

**Entry criteria:** R3 accepted; owner authorizes R4; confirmation that Free-tier Function scheduling behavior matches Decision D expectations (verified during this phase per the roadmap's "verify, never assume").

**Exit gates:** upload saga fault-injection matrix (storage success/metadata fail, reverse order, retry, abandonment sweep); retention eligibility tests incl. month/year rollover executed against the live Function once in the authorized window; orphan cleanup idempotence; quota ceilings enforced server-side with typed errors; built-client scan green (no storage keys); docs + runbook updated.

**User-visible result:** receipt attach/view/remove works with enforced quotas; expired content disappears on schedule while metadata history is preserved.

## R5 - Hardening, verification, deployment, go-live

**Goal:** prove the whole system, ship it, and hand over operations.

**Includes:** slices **13L** (Dashboard/report verification against live data incl. responsive geometry and Axe matrices) and **13M** (security/provider regression), roadmap **Phase 14** (integration and security QA: adversarial authorization bypass attempts across all four identities, cross-device concurrency soak, privacy audit, throttle enforcement review, dependency/secret re-audit), and **Phase 15** (deployment on zero-cost approved infrastructure: environment/secret configuration, prod build promotion, monitoring within free limits — provider logs, Function executions, periodic manual checks, no artificial traffic — rollback procedure, operational runbook covering Decision D pause/resume and backup cadence). Final seat provisioning (the remaining eligible approved account, plus the reserved fourth seat only if the owner directs) and the last deferred live proofs happen here under explicit owner supervision.

**Entry criteria:** R4 accepted; owner authorizes R5; target hosting choice confirmed against the zero-cost rule.

**Exit gates:** Phase 14 exit — no open critical/high findings and all end-to-end financial invariants pass (roadmap gate); Phase 15 exit — deployed smoke tests green and explicit release approval recorded; freeze-compliance audit confirming no frozen rule changed anywhere in R1-R5; `REQUIREMENTS.md`/state docs reconciled; go-live declaration by owner.

**User-visible result:** the finished production system, accepted and operable.

---

## Feature enablement matrix

| Capability | Login today | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|---|
| Session/login/recovery/logout | yes | yes | yes | yes | yes | yes |
| Dashboard/lists/details/reports (read) | milestone only | live | live | live | live | live |
| Create/join household, membership mgmt, rename, delete | pending msg | pending msg | live | live | live | live |
| Join-request lifecycle; leader badges/actions | pending msg | pending msg | live | live | live | live |
| Profile display-name edit | pending msg | pending msg | live | live | live | live |
| Card CRUD + card-paid expenses | pending msg | pending msg | pending msg | live | live | live |
| Expense create/edit/delete + locks/OCC | pending msg | pending msg | pending msg | live | live | live |
| Settlement lifecycle + history locks | pending msg | pending msg | pending msg | live | live | live |
| Receipt upload/view/delete + quotas | pending msg | metadata view | metadata view | metadata view | live | live |
| Scheduled retention + orphan cleanup | - | - | - | - | live | live |

## Cross-cutting rules for every phase

- Smallest coherent change; uncommitted-for-review convention continues per slice; commits only with explicit authorization (R1 carries the outstanding 13B commit approval).
- Domain/application layers stay provider-independent; presentation consumes the same runtime contract throughout — the frozen UI never redesigns for the backend.
- Every phase ends with: full Vitest + architecture guards + zero-warning lint + typecheck + production build + `npm audit` + `git diff --check` + built-client secret scan; live-provider contact only inside owner-approved windows.
- Any discovered contradiction with frozen behavior stops the phase for a documented resolution and owner decision (AIDOS change workflow).
- Zero-cost discipline: no paid tier, no artificial traffic; Decision D runbook governs pauses.

## Open decisions carried (blocking or shaping)

1. **13C decisions (block R1):** interim mutation affordance (Option B recommended); server-authoritative business date; live-read smoke timing.
2. **13B commit authorization (blocks R1):** the reviewed 13B tree still awaits an explicit commit approval.
3. **Hosting choice for Phase 15 (shapes R5):** must satisfy the zero-cost rule; decide no later than R4 exit so runbook/deployment rehearsals land in R5 cleanly.
4. **Self-service registration (Decision B follow-up, post-release track):** remains unresolved and out of scope for R1-R5; requires a dedicated design for account ownership without email verification before any implementation.
5. **Production Household bootstrap ritual (shapes R2 exit):** which account creates the Household and when member accounts join.

## Risk register (top items)

- **Provider transactional semantics under concurrent commits (R2/R3):** prove OCC/guard conflict behavior against the live API early in R2 with throwaway rows before building command flows on assumptions.
- **Function scheduling reality (R4):** verify cron/timezone/timeout on the live project; keep the manual fallback documented.
- **Free-tier pauses (all):** expected downtime per Decision D; communicate that retention catches up idempotently on resume.
- **Scope creep toward self-registration:** explicitly deferred; reopening requires a REQUIREMENT CHANGE cycle, not a phase-side addition.
- **Single-maintainer bus factor / no provider backups:** mitigate via the R2 backup tooling cadence (monthly + pre-dangerous-change) and restore drills.

## Sequencing summary

R1 reads -> R2 tenancy commands + backups -> R3 financial commands -> R4 binaries + automation -> R5 QA + deploy + go-live. Each phase produces its own detailed plan doc before code; this umbrella document is the owner-facing map and authorization checkpoint list.
