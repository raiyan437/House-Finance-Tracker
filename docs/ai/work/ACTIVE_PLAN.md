# Active Implementation Roadmap

## Status and authorization

The roadmap and frozen Phase 2-4 implementation decisions are approved. Phases 1-4 are complete. Phase 5 and all later phases remain unauthorized until explicitly approved.

## Reconciliation findings

No direct contradiction exists between the original AIDOS constraints and the frozen context. One documentation mismatch was corrected: the app is a shared household tracker, not merely a personal finance app.

The following implementation-critical choices were approved as frozen clarifications.

1. **Split remainder order** - Use canonical ascending participant ID order for deterministic equal-split remainder poisha and as the final tie-break for percentage rounding.
2. **Percentage precision** - Accept up to two decimal places and store percentage units as integer basis points (`100% = 10,000`). Convert to poisha with largest-remainder allocation; tie-break by participant ID.
3. **Settlement optimization** - Use deterministic largest-debtor/largest-creditor matching, ordered by absolute balance then member ID. It yields at most `members - 1` transfers; do not claim a globally minimal transfer count unless a later requirement explicitly demands it.
4. **Stale pending settlements** - Snapshot sender, receiver, amount, and originating recommendation at creation. Confirmation records the externally received payment even if expenses later changed; because the receiver confirms a real payment, its exact amount affects balances and may create a new reverse balance. Show a stale-balance warning before confirmation when current obligation differs.
5. **Leader editing a Card-paid expense** - A non-owner leader may preserve the opaque existing Card payment reference and edit permitted non-card fields, but cannot see/select another user's card or change private card metadata. Changing Card selection is owner-only; changing payment method needs explicit confirmation that private metadata will be detached.
6. **Former-member history** - Freeze amount, payer, participants, shares, date, payment method, and deletion for any expense involving a former member when the action would change their settled zero position. Permit only non-financial metadata edits that preserve financial results. Raise ambiguous cases.
7. **Deleting referenced cards** - Soft-delete/archive the card. Existing expenses retain an owner-private historical label snapshot/reference; the card is unavailable for new expenses.
8. **Local persistence** - Use IndexedDB behind repository interfaces for structured local data and receipt blobs; keep a seed/reset development adapter for repeatable tests. This is a replaceable technical choice, not a production backend commitment.
9. **Dates and month boundaries** - Store expense dates as date-only `YYYY-MM-DD`; calculate month membership without UTC conversion. Store audit timestamps as ISO instants. Display in BDT/English initially unless approved UI references require Bengali localization.
10. **Local authentication boundary** - Build all required auth screens and state transitions against a local auth repository, including seeded identity switching. Real verification emails, password delivery, security, and production sessions are deferred to Appwrite integration; local UI must clearly remain development-only.
11. **Money formatting boundary** - Keep exact canonical money conversion in the domain as ungrouped decimal text. Currency symbols, Bangladesh digit grouping, and other display localization belong outside the domain and cannot participate in financial arithmetic.
12. **Zero-share participants** - A selected participant may receive zero poisha when exact deterministic allocation requires it. Completed allocations retain every selected participant exactly once, including zero-share participants.
13. **Unordered Pending uniqueness** - For one household, allow at most one Pending settlement for the same unordered member pair. Same-direction and reverse-direction duplicates are blocked until the existing claim becomes terminal; terminal history does not block later creation.
14. **Sole-leader exit** - A sole remaining leader cannot leave or trigger automatic deletion. Explicit household deletion is the only exit path after every deletion gate passes.
15. **Leadership transfer finance boundary** - Leadership transfer is an authority change and does not require zero balances. It must transfer from the current leader to another active member and preserve exactly one active leader; later leave still requires zero balance and no Pending settlements.
16. **Settlement creation boundary** - A new settlement must exactly match a current full deterministic recommendation. Its Pending snapshot then retains the original parties and amount regardless of later balance or recommendation changes.

All sixteen items are approved. Reopening one requires change analysis under the AIDOS requirement-change workflow.

## Model/reasoning scale

- **High** - GPT-5 Codex with high reasoning for financial invariants, architecture boundaries, privacy/security, migrations, and multi-module debugging.
- **Medium** - GPT-5 Codex with medium reasoning for contained feature/UI implementation with established patterns.
- **Low** - GPT-5 Codex with low reasoning only for narrow mechanical work after decisions and patterns are fixed.

## Phased roadmap

### Phase 1 - Project foundation

Set up Next.js/TypeScript, Tailwind, shadcn/ui, lint/typecheck, Vitest/RTL, Playwright, path boundaries, environment conventions, and the local-only development shell - without product features. Define repository contracts at a skeleton level and architecture guard tests. **Reasoning: medium-high** because early boundaries affect every phase. Exit: clean build, lint, typecheck, unit smoke test, and Playwright smoke page.

**Result: complete (2026-08-12).** Established Next.js 16.3 App Router, React 19.2, strict TypeScript, Tailwind 4, shadcn/Radix/Lucide foundations, layer skeletons and architecture guards, Vitest/RTL, Playwright Chromium, Git `main`, and concise project commands. No Appwrite, IndexedDB adapter, financial/domain logic, or product feature was added.

**Verification:** dependency audit reported zero vulnerabilities; lint passed; typecheck passed; production build passed; Vitest passed 5 tests across 2 files; architecture guard passed 4 layer cases; Playwright passed the Chromium foundation flow with explicit meaningful-content and no-error-overlay assertions; local server returned HTTP 200 with no logged runtime error.

### Phase 2 - Domain model and exact money engine

Define IDs/entities/value types, integer-poisha parsing/formatting, date-only handling, split inputs, invariants, and Zod boundary schemas. Implement equal, amount, and percentage split logic as pure functions after decisions 1-2 are approved. **Reasoning: high** due financial correctness and rounding. Exit: exhaustive deterministic unit/property-style boundary tests with no React/storage imports.

**Result: complete (2026-08-12).** Added branded safe-integer poisha and basis-point values, strict decimal-string parsing, deterministic ungrouped canonical BDT conversion, date-only Gregorian validation, opaque IDs with code-unit ordering, completed financial input types, and pure equal/amount/percentage allocation. Equal remainders use stable participant-ID order; percentage allocation uses BigInt largest-remainder calculations with stable-ID ties. Exact allocations retain every selected participant exactly once, including zero shares. Zod exists only at the application boundary.

**Verification:** focused Phase 2 suite passed 119 tests across 9 files; full Vitest passed 124 tests across 11 files; lint passed; TypeScript passed; production build passed; architecture guards passed and explicitly prohibit Zod/framework/storage-facing imports from the domain. Source audit found no floating-point parsing, rounding, locale formatting, or number-based financial multiplication/division in Phase 2 code.

### Phase 3 - Balance, settlement, membership, and permission engines

Implement balance signs, confirmed-settlement effects, recommendation algorithm, lifecycle rules, duplicate protection, leave/remove/transfer/delete gates, former-member safety, expense permissions, and card-privacy projections after decisions 3-6 are approved. **Reasoning: high** due temporal finance, privacy, and cross-domain invariants. Exit: scenario matrix tests proving zero-sum balances and lifecycle/permission behavior.

**Result: complete (2026-08-12).** Added pure exact-poisha household ledgers with positive-creditor/negative-debtor convention; confirmed-only settlement effects; deterministic largest-debtor/largest-creditor recommendations with stable-ID ties; exact-current-recommendation settlement creation; immutable lifecycle transitions; stale-claim assessment; household-scoped unordered-pair Pending uniqueness; creator/leader/member expense permissions; private-card projection/edit capabilities; conservative former-member financial fingerprints; and leave/remove/leadership-transfer/household-deletion gates. No persistence, UI, auth, Appwrite, receipt, card CRUD, dashboard, or Phase 4 work was introduced.

**Verification:** focused Phase 3 suite passed 78 tests across 12 files; full Vitest passed 202 tests across 23 files; lint passed with zero warnings; TypeScript passed; architecture guards passed; production build passed; Playwright passed and exited normally using the established Windows teardown permission; dependency audit reported zero vulnerabilities. Deterministic property-style tests prove generated ledgers remain exactly zero-sum under reordered inputs and generated recommendations resolve valid balance sheets exactly. Source audit found no floating-point financial parsing, rounding, localization, multiplication, or division.

### Phase 4 - Local application layer and persistence

Implement application services, repository interfaces, IndexedDB/local repositories, seed/reset fixtures, audit events, receipt-blob lifecycle, local auth state, and identity switching. No Appwrite SDK. **Reasoning: high** because persistence and privacy projections must preserve domain boundaries. Exit: repository contract tests, reload persistence, deterministic seeds, and no private-card leakage across identities.

**Result: complete (2026-08-13; uncommitted for review).** Added domain records and validators for profiles, households, join requests, expenses, cards, private historical card snapshots, receipts, and audit events; application-owned repositories and provider-independent services; explicit atomic local operations; IndexedDB schema/records/mappers/repositories using `idb`; `fake-indexeddb` integration coverage; optional derived uniqueness keys; owner-private card history; validated JPEG/PNG/WebP Blob storage; append-only audit records; development session switching; deterministic seed/reset; typed blocked/newer-version failures; and client-only Next.js composition. Household deletion atomically tombstones the household, retains every membership as former history, and releases active-membership uniqueness keys. No UI, Appwrite, API persistence, derived financial store, or Phase 5 work was added.

**Verification:** Phase 4 focused tests passed 28 tests across 2 integration files; architecture guards passed 6 cases; full Vitest passed 232 tests across 25 files, preserving all Phase 2/3 coverage; lint passed with zero warnings; TypeScript passed; production build passed and retained a statically prerendered root route; Playwright Chromium smoke passed 1 test; dependency audit reported zero vulnerabilities; and `git diff --check` passed. Tests cover close/reopen persistence, transaction rollback, optional derived uniqueness, malformed-record rejection, receipt byte round trips/tombstones, private-card projection and opaque leader edits, referenced-card archival, confirmed-settlement immutability, former-member/soft-deleted-expense retention, deterministic seed/reset, identity switching, schema/version failures, and absence of derived financial stores.

**Known verification boundary:** `fake-indexeddb` is the primary repository environment and is not identical to native browser IndexedDB. No product/test-only route was added solely for infrastructure testing. Native-browser repository verification remains an integration check when a later authorized UI/runtime phase first consumes `LocalDevelopmentRuntime`; existing Playwright smoke verifies that the browser build and Server Component boundary remain healthy.

### Phase 5 - Application shell and design system

Build responsive desktop sidebar/mobile navigation, route shell, tokens, typography, buttons, inputs, cards, status treatments, dialogs/sheets, skeletons, toasts, and accessibility primitives from the canonical design baseline. **Reasoning: medium** because product logic is low but consistency is broad. Exit: reusable component showcase/routes pass visual, keyboard, responsive, and contrast checks.

### Phase 6 - Local authentication and household onboarding

Build local register/login/reset/verification-state UI, dev identity switcher, create/join/cancel/accept/reject flows, and pre-acceptance privacy boundaries. **Reasoning: medium-high** due permission states despite mock infrastructure. Exit: multi-user Playwright onboarding flows and proof that pending requesters cannot access household data.

### Phase 7 - Expenses and receipts

Build expense list/search/filter/sort, single-page add form with live allocation summary, owner-only card selection, local receipt previews/storage, details/history, edit, and soft delete. **Reasoning: high** because this joins forms, money, privacy, audit, and recalculation. Exit: all split modes and edit/delete permissions pass unit, component, and multi-user browser tests.

### Phase 8 - Settlements

Build recommendations, external-payment disclosure, pending/confirm/reject/cancel flows, badges, duplicate prevention, stale warnings, and immutable history. **Reasoning: high** due financial lifecycle and concurrency-like behavior. Exit: sender/receiver Playwright matrix and exact balance assertions for every status.

### Phase 9 - Cards

Build private card CRUD, palette/type UI, no-card path from expenses, archive behavior, and owner-only projections. **Reasoning: medium-high** because UI is contained but privacy is critical. Exit: cross-identity tests prove metadata is absent - not merely hidden - and referenced history remains valid.

### Phase 10 - Household management and leadership

Build member/request management, role transfer, leave/remove/delete gates, explanatory disabled states, and historical-member protections. **Reasoning: high** due permissions and irreversible-looking actions. Exit: role and financial-gate matrix passes with explicit confirmations and retained history.

### Phase 11 - Dashboard, analytics, and monthly reports

Build selected-month spending modules, current-state outstanding/health/balances, dynamic daily Recharts bar graph, payment mix, recent expenses, allowed analytics, and Dashboard-linked report. **Reasoning: medium-high** due date aggregation and distinction between monthly and current state. Exit: leap-year/month-boundary aggregation tests, accessible chart summaries, and responsive visual QA.

### Phase 12 - Local MVP stabilization

Complete responsive behavior, accessibility audit, empty/loading/error/success states, full Playwright journeys, visual regression/gut checks, performance checks, dependency/cost audit, and defect fixes. No new scope. **Reasoning: high** for cross-feature debugging and financial regression review. Exit: agreed local-MVP acceptance checklist green and user declares local MVP stable.

### Phase 13 - Appwrite architecture and integration

Only after the stability gate: design collections/indexes/permissions, production auth, private receipt storage, atomic operations, anti-enumeration controls, and Appwrite repository adapters. Preserve application/domain APIs. **Reasoning: high** due security, migration, and concurrency. Exit: local and Appwrite adapters pass shared contracts; server-side authorization is verified.

### Phase 14 - Integration and security QA

Test production-like multi-user concurrency, authorization bypass attempts, card/receipt privacy, settlement duplication, atomicity, data migration, recovery, and audit history. **Reasoning: high** due adversarial security and financial integrity. Exit: no open critical/high findings and all end-to-end financial invariants pass.

### Phase 15 - Deployment

Choose only zero-cost approved infrastructure, configure environments/secrets, CI quality gates, deployment, monitoring within free limits, and rollback/runbook documentation. **Reasoning: medium-high** because mechanics are established but release safety matters. Exit: deployed smoke tests and explicit release approval.

## Current authorization boundary

Stop after Phase 4. Phase 5 may begin only after explicit user authorization. Before each later phase, re-check current state, frozen decisions, and prior exit evidence.
