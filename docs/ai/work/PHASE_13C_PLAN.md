# Slice 13C Plan - Read Adapter + Production Product Surface

**Status:** Planning approved by owner on 2026-08-26. Implementation is **not** authorized by this document; per the Phase 13 Rev 2 gate, completing/planning one slice never authorizes the next. Baseline: uncommitted Phase 13B tree on `feature/phase-13-appwrite` (`bed70e3` + untracked `src/infrastructure/appwrite/reads/`).

## Problem and intended outcome

Today, under `APP_COMPOSITION=appwrite`, a successful login reaches only the `AuthenticatedMilestone` placeholder (src/app/_providers/production-session-provider.client.tsx:39); the frozen product UI never renders because the production composition constructs no application runtime. This slice delivers the **read half** of the approved trusted architecture (PHASE_13_PLAN.md "Trusted architecture") so that after login the user sees the real frozen shell — Dashboard, Expenses, Details, Settlements, Cards, Household state, Reports, Profile — rendered from live Appwrite data through trusted Route Handlers. Every mutation remains explicitly unavailable until its own slice (13D/13F–13J); this slice adds no command path.

Intended outcome, stated as the phase contract:

1. Login -> `/` -> `/dashboard` renders the canonical product UI with real provider data.
2. Browsers still hold no Appwrite keys and make no direct Appwrite calls.
3. Domain and application layers remain untouched and provider-independent; only composition, infrastructure adapters, Route Handlers, and the guarded architecture tests change.
4. Zero writes to business tables are issued anywhere in 13C code paths.

## Approved constraints this slice must honor

- Frozen Local MVP behavior is preserved exactly; Appwrite adapts the provider without rewriting rules (ACTIVE_PLAN.md freeze approval, 2026-08-23).
- Trusted boundary shape (PHASE_13_PLAN.md): Browser -> Route Handlers (session verification, actor resolution, Clock/IDs injection, throttles) -> unchanged Application/Domain layers -> Appwrite adapter (server SDK + runtime key only).
- Privacy is a data-shape rule: private Card snapshots only ever reach their owner; receipts are creator/historical-uploader readable; leader projections stay opaque. Because the *unchanged* application services produce the projections, privacy survives by construction — verified again by tests.
- Money stays exact integer poisha end-to-end; mappers reject unsafe integers; no float arithmetic anywhere.
- Registration stays locked down; no `/api/auth/register`, no verification, no production email editing (architecture guards already enforce).
- Secrets stay confined to `src/infrastructure/appwrite/**` (guard: `appwrite-boundaries.test.ts`).

## Scope

### 13C-a - TablesDB read foundation

- Complete and adopt the untracked `src/infrastructure/appwrite/reads/mappers.server.ts` (row -> domain record mapping with strict Zod + domain `assert*` revalidation, typed `MALFORMED_PERSISTED_DATA` failure). Corrections while adopting:
  - `profiles.version`: accept `int >= 1` passthrough instead of `z.literal(1)` so future version bumps cannot brick reads (local records currently persist version 1; behavior identical today).
  - Keep the reconstructed card payment reference convention `private:${expenseId}` exactly as written (matches `expensePrivateReference`).
- Add `src/infrastructure/appwrite/reads/tables.client.server.ts`: a thin, typed TablesDB access wrapper over the runtime credential (config-sourced; lists use explicit paged queries with a bounded page loop and a hard safety cap).
- Add `src/infrastructure/appwrite/reads/read-repositories.server.ts`: implementations of the read methods of `ApplicationRepositories` only:
  - profiles `getById/getByIds`; households `getById/findByCode`; memberships `get/findActiveByUser/listByHousehold`; joinRequests `getById/findPendingByUser/listByHousehold`; expenses `getById/listHouseholdHistory/listActiveForBalances/getPrivateCardSnapshot`; settlements `getById/listByHousehold/findPendingForPair`; cards `getOwned/listOwned/getOwnedRemovalAction`; receipts `listForExpense/availableBytesByUploader/getMetadata/readContent` (metadata reads; bytes via Storage in the proxy route); auditEvents `listByHousehold`.
  - Every write-bearing interface method is absent, not stubbed: the object satisfies only narrowed read interfaces so TypeScript proves no write path exists in 13C.
  - Index coverage uses the already-applied v1 indexes (`by_household_*`, `by_user_status`, `by_owner*`, `pair/status`, retention indexes). `receipts.availableBytesByUploader` filters `uploaderId + contentState` without a dedicated index — acceptable at the frozen envelope (~4 users, ~200 MiB ceiling); flagged below as an optional drift-managed follow-up, not part of this slice.

### 13C-b - Trusted request context

- Extend the server dependency wiring (new `src/infrastructure/appwrite/runtime/deps.server.ts`, sibling of `auth/deps.server.ts`) providing per-request:
  - session verification and actor resolution from the `hft_session` cookie (session client `account.get()` + allowlist check; invalid/expired -> typed anonymous; provider failure -> typed unavailable);
  - a `CurrentSession` port resolving `getCurrentUserId()` from that actor;
  - the injected server Clock (`values.now()`) as the authoritative instant source;
  - reuse of the HMAC-opaque throttle engine with one added rule constant: house-code lookup/generation `10 per hour` per opaque identity (per approved rate-limit table).
- A server factory builds the existing `Dependencies` object consumed by the unchanged `ProfileApplicationService`, `HouseholdApplicationService`, `ExpenseApplicationService`, `SettlementApplicationService` (reads), `CardApplicationService` (reads), and `HouseholdAnalyticsApplicationService`. Read-only repository set means the compile-time guarantee above holds.

### 13C-c - Trusted Route Handlers (read surface)

All under `src/app/api/app/**`, following the established thin-wrapper pattern of `api/auth/login/route.ts` (handler delegates to a tested server function; Zod validates inputs; generic sanitized errors):

| Endpoint | Returns (unchanged application view types) |
|---|---|
| `GET /api/app/bootstrap` | `{ session: CurrentSessionView-shape, household: HouseholdAccessState }` |
| `GET /api/app/household/access` | `HouseholdAccessState` |
| `GET /api/app/household/members?householdId` | `ExpenseMemberView[]` |
| `POST /api/app/household/lookup` | `JoinableHouseholdView` (throttled) |
| `GET /api/app/household/code-candidate` | generated candidate (throttled) |
| `GET /api/app/expenses?householdId&includeDeleted` | `ExpenseView[]` |
| `GET /api/app/expenses/{expenseId}` | `ExpenseView` |
| `GET /api/app/expenses/{expenseId}/activity` | `ExpenseActivityView[]` |
| `GET /api/app/expenses/{expenseId}/receipts` | `ReceiptView[]` |
| `GET /api/app/receipts/{receiptId}` | receipt bytes stream (private bucket read via runtime key, creator/uploader-gated through the application service) |
| `GET /api/app/cards` | `CardPageView` |
| `GET /api/app/cards/selectable` | `MyCardSummaryView[]` |
| `GET /api/app/cards/{cardId}/removal-preview` | `CardRemovalPreview` |
| `GET /api/app/settlements?householdId` | `SettlementPageView` |
| `GET /api/app/settlements/{settlementId}/pending-preview` | `PendingSettlementView` |
| `GET /api/app/analytics/dashboard?householdId&year&month` | `DashboardPageView` |
| `GET /api/app/reports/monthly?householdId&year&month` | `MonthlyReportPageView` |
| `GET /api/app/business-date` | server-authoritative Dhaka `ExpenseDate` |
| `GET /api/app/receipt-quota` | available-bytes number |

Rules for every handler:

- `dynamic = "force-dynamic"`; `Cache-Control: no-store` on all responses including receipt bytes.
- 401 `{ error: "AUTH_REQUIRED" }` when anonymous; 503 sanitized on provider unavailability; 429 generic on throttle; application codes map deterministically (`NOT_FOUND`->404, `CONFLICT`/OCC codes->409, validation codes->400/422); unexpected failures log server-side and return 500 with the shared sanitized message. Raw provider errors never reach the client.
- IDs/months/flags validated by Zod at the boundary (non-empty, length/charset caps; `YYYY-MM` calendar month).
- Views serialize as JSON directly: all persisted poisha values are safe integers by invariant and are reasserted server-side by domain validators before serialization; basis points likewise. No numeric transformation happens in transport.

### 13C-d - Production browser runtime and layout swap

- New `src/infrastructure/production-runtime.client.ts`: browser fetch transport implementing the exact `HouseholdApplicationActions` / `ExpenseApplicationActions` / `SettlementApplicationActions` / `CardApplicationActions` / `AnalyticsApplicationActions` interfaces. It contains zero Appwrite imports (architecture-guarded). Command actions are wired to their future endpoints and surface a typed `COMMANDS_PENDING` outcome until those slices land (see interim-behavior decision below).
- New `src/app/_providers/production-application-runtime.client.tsx`: mirrors `local-application-runtime.client.tsx` semantics (loading/error/retry states, authoritative reconstruction after focus, Strict Mode-safe acquisition, hydration-safe refresh) but sources state from `/api/app/bootstrap`.
- `(product)/layout.tsx` appwrite branch becomes: authenticated session -> `AppShell` fed by the production provider; anonymous -> existing redirect; provider-unavailable -> existing retry screen. The `AuthenticatedMilestone` screen is removed once the swap ships.
- Shell dev-tools strip stays hidden automatically (composition root omits development identities).
- Profile page: production hides the email edit field entirely (Appwrite Auth email is authoritative; frozen requirement) and treats display-name save as a pending command until its slice.

### 13C-e - Architecture guard amendments (deliberate, enumerated)

`appwrite-boundaries.test.ts` updates, each replacing a "not yet" assertion with its 13C invariant:

1. Keep: SDK confined to `src/infrastructure/appwrite/`; secret names confined to `src/infrastructure/appwrite/`.
2. Replace the "no client-runtime wiring" scan with: files outside `src/infrastructure/appwrite/` may reference the adapter only from `src/app/api/**` route handlers and the `(product)` layout/provider seam; the browser production runtime module must not import `node-appwrite` or any `*.server` module (add a `server-only` import check).
3. Update the pinned layout assertion to the new authenticated branch while keeping the prohibition of `LocalApplicationRuntime`/IndexedDB/dev-tools in the production provider.
4. Add: every file under `src/infrastructure/appwrite/reads/` and `runtime/` is server-only; no `localStorage`/`sessionStorage` anywhere new (existing hygiene guard continues to apply).

### 13C-f - Verification and documentation

Test matrix (proportionate to a read-only slice):

1. Mapper unit tests: happy-path row fixtures per table + malformed rejection matrix (bad enums, lifecycle contradictions, unsafe BigInt, contradictory timestamps) asserting typed `MALFORMED_PERSISTED_DATA` without leaking row contents.
2. Read-repository tests against a stubbed TablesDB (pattern proven in `bootstrap/apply.test.ts`): filters, paging bounds, undefined-vs-notfound semantics, private snapshot owner gating.
3. Shared read-contract suite: one parameterized scenario set (seeded household with members/former member/expenses incl. percentage + card + deleted, settlements in every status, join requests) executed against both the fake-indexeddb local repositories and the Appwrite read repositories over the stub, asserting deep-equal projections (access state, expense views, settlement page, dashboard/report numbers, card page). This operationalizes the roadmap exit criterion "local and Appwrite adapters pass shared contracts" for the read half.
4. Route-handler tests: auth required, membership authorization enforced by the unchanged services (outsider -> 404), privacy (non-owner receipt bytes -> 404, private card fields absent from all responses), throttle engagement, error mapping table, no-store headers.
5. Component/browser: production-composition Playwright smoke with intercepted `/api/app/*` fixtures proving Dashboard/Expenses/Settlements/Cards/Household/Reports render the frozen UI without IndexedDB and with zero console/hydration errors; Axe serious/critical clean. Live-provider read smoke is a short manual checklist executed during the separately authorized verification window; full multi-browser/live matrices remain owned by 13L.
6. Standard gates: full Vitest, architecture guards (amended), zero-warning ESLint, TypeScript, production build, `npm audit`, `git diff --check`, built-client secret scan extended to the new client modules.

Documentation: `PROJECT_STATE.md` snapshot + gate line, `ACTIVE_PLAN.md` slice result entry, `AI_LESSONS.md` entries for durable discoveries (e.g., Appwrite REST BigInt stringification, paging behavior).

## Explicit exclusions (remain gated)

- All commands/mutations: household create/join/rename/leave/remove/transfer/delete, expense create/edit/delete, settlement create/confirm/reject/cancel, card create/update/remove, receipt upload/user-delete, profile update (13D/13E/13F–13J).
- OCC/idempotency enforcement, coordination-guard writes, signed backdated confirmation tokens (13D/13E).
- Receipt upload saga/reservations, Storage quota accounting changes (13J).
- Retention worker implementation/deployment (13K).
- Any schema change (including a receipt uploader index) unless a measured need appears; if so it goes through the planner/apply drift process with owner approval.
- Registration/self-signup, verification, email editing (unchanged lockdown; Decision B follow-up unresolved).
- Deployment concerns (15) and Phase 14 QA.

## Decisions requested from the owner before implementation

1. **Interim mutation affordance (recommended Option B):** keep all buttons/forms enabled; commands resolve to an honest inline/toast message ("This action arrives in the next production update") via typed `COMMANDS_PENDING`. Option A (disabling controls with tooltips) is a larger frozen-UI rewrite and hides progress; B keeps diffs minimal and each later slice lights features up with no further UI work.
2. **Server-authoritative business date:** confirm `/api/app/business-date` (Dhaka, server Clock) replaces the client-computed date in production composition only; local composition unchanged.
3. **Live-read smoke timing:** approve executing the manual read-only checklist against the live project after local gates pass (reads cannot mutate; provider state currently: empty business tables, one Profile), or defer all live contact to 13L.

## Risks and mitigations

- **Provider query limits/paging:** explicit bounded pagination with safety caps from day one; envelope-scale data keeps this cheap.
- **BigInt over REST:** Appwrite returns BigInt columns as strings; the adopted mapper already normalizes string/bigint/number through `Number.isSafeInteger` rejection.
- **Session expiry mid-use:** transport maps 401 to the existing anonymous redirect path; focus-refresh reconstructs state like the local runtime.
- **Provider pause/cold starts:** existing provider-unavailable screens cover bootstrap and in-page failures with retry; Decision D runbook unaffected.
- **Accidental writes:** compile-time read-only repository narrowing + code audit + route inventory review; the runtime key intentionally retains `rows.write` for later slices, so enforcement is structural (no write code exists), not scope-based, during 13C.

## Exit criteria

1. Under `APP_COMPOSITION=appwrite`, login lands on the real Dashboard and all product routes render provider-backed, projection-identical data (shared contract suite green).
2. No business-table write exists in 13C code; audit confirms zero mutations during verification.
3. Full gate matrix green; amended architecture guards prove the new boundaries.
4. Docs updated; slice left uncommitted for owner review per standing convention.
