# AI Lessons

Durable project learnings only. Add entries when a discovery or correction should influence future work.

## 2026-08-12 — AIDOS initialization

- The product requirements and UI/UX design are frozen, but their approved context is not present in the workspace yet.
- Treat that missing context as a planning gate; do not infer screens or domain behavior.
- Keep poisha values as integers throughout domain calculations and test the boundary explicitly.

## 2026-08-12 - Frozen context reconciliation

- The approved context is now consolidated in `REQUIREMENTS.md`; the missing-context planning gate is closed.
- Financial determinism requires explicit tie-break rules, not merely exact totals.
- Card privacy constrains data shape and edit workflows, including leader actions; hiding fields visually is insufficient.
- Pending settlements and historical-member edits are temporal financial cases that need approved rules before their domain phases.
- Canonical desktop screens define the reusable visual language; responsive and remaining screens extend that baseline during implementation.

## 2026-08-12 - Phase 1 foundation

- Next.js 16.3 appends a managed, version-aware guidance block to the existing root `AGENTS.md` during development; it preserved the AIDOS instructions and points agents to bundled local framework docs.
- Clean-checkout typechecking must not depend on generated Next route types; the root layout uses an explicit `ReactNode` contract.
- Vite 8 resolves TypeScript paths natively, so `vite-tsconfig-paths` is unnecessary.
- Architecture guards now enforce that domain/application code cannot import framework, Appwrite, or inward-facing layers.

## 2026-08-12 - Phase 2 exact finance engine

- A safe-integer `number` API can retain ergonomic poisha values while BigInt intermediates protect parsing, totals, division, multiplication, and remainder allocation from precision loss and overflow.
- The repository's ES2017 TypeScript target supports BigInt operations through constructor syntax but rejects BigInt literal syntax; use `BigInt(...)` unless the target is deliberately changed in a later approved phase.
- Exact allocation membership is independent of positive share value: zero-share selected participants must remain explicit so recalculation, validation, and later persistence preserve the original participant set.
- Canonical domain conversion stops at ungrouped decimal money text. Currency symbols, grouping, and localization belong to presentation and cannot feed financial calculations.

## 2026-08-12 - Phase 3 temporal finance and permissions

- Model external settlement claims as immutable snapshots: staleness is advisory, while confirmation applies the original exact amount and may legitimately reverse a later balance.
- Household balance aggregation and recommendation simulation both need BigInt working values and independently validated zero-sum boundaries; TypeScript types alone are not sufficient for persisted-looking financial records.
- Unordered-pair Pending uniqueness prevents crossing stale claims without rewriting history; terminal records remain historical evidence and do not block a later exact recommendation.
- Former-member safety is strongest as an invariant over a canonical financial fingerprint, allowing only changes that provably preserve amount, payer, participants, shares, date, payment history, and deletion state.
- Card privacy is a data-shape rule: non-owners receive no private reference, while leader edit intents can preserve an opaque reference internally or explicitly detach it without exposing it.

## 2026-08-13 - Phase 4 local application and persistence

- IndexedDB conditional uniqueness is best represented by optional, deterministic derived keys under ordinary unique indexes; inactive and terminal records omit the key so history remains without blocking future actions.
- Private card history requires physical data separation as well as projection rules. A non-owner leader can preserve an existing private expense record transactionally without loading its contents into that application operation.
- Household soft deletion must atomically convert active memberships to retained former records; otherwise active-membership uniqueness would strand users after the explicit household exit flow.
- Browser Blob objects may cross realms in test environments, so validate their observable metadata and readable bytes rather than relying on `instanceof Blob`. Test receipt signatures against actual bytes, not filename or MIME text alone.
- IndexedDB transaction callbacks must prepare validation and binary input before opening the transaction and keep participating stores on one transaction. Failed request/unique-index operations require explicit transaction rejection handling to avoid false success or unhandled aborts.
- A client-only local runtime plus application-owned current-session port preserves Next.js Server Component boundaries and leaves future Appwrite authentication/persistence replaceable.

## 2026-08-13 - Phase 5 application shell and design system

- A module-scoped runtime acquisition guard plus deferred zero-holder close survives React Strict Mode remounts without leaking duplicate IndexedDB connections; abandoned initialization must close a late connection before rejecting.
- Keep the React runtime context narrower than the infrastructure object: presentation needs current session view state and later feature-facing service hooks, not repositories, database handles, or reset controls.
- Frozen muted and semantic colors may be valid tokens without meeting small-text contrast in every pairing. Preserve the palette, but use the stronger approved text color where Axe or manual contrast review shows a token is unsuitable for readable copy.
- Bottom-navigation safety needs both safe-area padding on the fixed bar and matching content-bottom clearance; responsive tests should compare computed values instead of relying on screenshots alone.
- Development identity switching remains easiest to replace when one composition gate owns the environment branch and the product shell consumes only the ordinary current-session view.

## 2026-08-13 - Phase 6 local session and household onboarding

- Pre-acceptance privacy is strongest as an application projection: Pending/requester UI receives only an opaque household ID, name, and code, so private household records never enter React state to be accidentally rendered.
- One-house and Pending-request checks must be repeated inside the named IndexedDB transaction. Application prechecks improve errors, while transaction-time index checks close the cross-tab race window and rollback tests prove no partial request/membership/audit state.
- Client-only membership routing needs a deterministic loading gate for household-dependent routes, while independent routes remain explicitly outside the gate. Mutation handlers should retain their local pending state until authoritative runtime reconstruction and success navigation finish.
- Injected household-code candidates make the 32-collision limit deterministic in tests; the browser generator can use unbiased cryptographic randomness without coupling application services to browser APIs.

## 2026-08-18 - Phase 7 financial source persistence

- Persist user-entered financial source data together with its derived result whenever the source cannot be uniquely reconstructed. Domain reconstruction must prove the two representations agree instead of silently preferring one.
- Legacy derived-only financial records can remain effective history without fabricated source inputs: identify the limitation explicitly, preserve their stored result, and block workflows that require reconstruction while retaining provably non-financial edits.
- Receipt edits are safest as draft additions/removals committed with the expense and audit events in one transaction; expense soft deletion is a separate historical state and must not destroy retained receipt evidence.
- Permission and former-member checks need a transaction-time membership recheck as well as application prevalidation, because a local cross-tab membership change can occur between form load and Save.

## 2026-08-18 - Phase 8 settlement workflows

- Exact-current settlement creation cannot rely on application prevalidation. The authoritative IndexedDB write transaction must lock and reread every financial source store, rerun the domain balance/recommendation/Pending-pair policies, and append the claim plus audit only after the requested recommendation still matches.
- Pending settlement staleness is a fresh presentation concern over immutable historical source: refresh it before receiver confirmation, translate it outside React, and never let it alter or block the original-amount lifecycle.
- Current-user settlement views and attention badges are derived projections, not persisted state. Reconstruct them after every mutation and identity switch so sender waiting, receiver actions, and navigation attention remain consistent.
- Date-only expense values and settlement instants need separate presentation paths: expense dates never pass through timezones, while settlement/audit ISO instants render in the viewer's local timezone.

## 2026-08-18 - Phase 9 owner-private Cards

- A private user resource should not be forced into a Household audit model: when the existing audit store is broadly Household-scoped, omitting Card lifecycle events is safer than duplicating private IDs or inventing a Household relationship.
- Historical snapshots must be derived inside the authoritative write transaction from a selected private identity, not accepted as metadata from React. This both closes Card edit/archive races and keeps presentation projections narrow.
- Informed destructive consent is part of the transaction contract: pass the previewed Delete/Archive consequence, recompute reference status at commit, and reject drift so a physical Delete can never silently become Archive.
- IndexedDB versionchange migrations can safely reject unsupported private data when the first typed, sanitized failure is retained and the whole transaction is explicitly aborted; tests must reopen the old version to prove that even earlier cursor writes rolled back.
- Owner-keying the private feature subtree is a robust identity-switch boundary: it discards form, dialog, request, and Card-list state immediately instead of relying on an effect to clear prior-user data after render.

## 2026-08-19 - Phase 10 Household management

- Historical role and current authority must be separate predicates: preserving `role = leader` on a former membership is safe only when every authorization path also requires `status = active`.
- Conditional IndexedDB uniqueness keys are lifecycle resources. Leave, Remove, deletion, and Pending-request closure must omit their active/Pending derived keys in the same transaction that retains the historical record, or future Create/Join actions remain incorrectly blocked.
- Type unions are not runtime authorization. A deletion-only terminal state needs an explicit allowlist on every ordinary transition boundary so malformed JavaScript cannot manufacture it by bypassing TypeScript.
- A destructive transaction's store list is a privacy and preservation contract: Household deletion can prove Cards, private snapshots, receipts, and terminal financial history are untouched when those stores are absent from the write transaction and raw before/after records are compared.
- Initial avatars next to visible identity text should be decorative. Adding `aria-label` to a roleless avatar span duplicates the name and violates current Axe ARIA rules; hide the avatar from assistive technology and keep the adjacent text authoritative.

## 2026-08-19 - Phase 11 derived analytics

- Expense month analytics and Settlement activity require deliberately separate calendars: group canonical Expense Date text directly by `YYYY-MM`, while bucketing Settlement instants with the viewer's local `Date` fields at the client application boundary.
- A Pending Settlement has no balance effect, so current recommendations may retain the same pair. Factual health counts must suppress recommendation edges for unordered pairs with active Pending claims instead of double-counting one unresolved relationship.
- Display percentages can exceed JavaScript's safe-integer range even when every poisha total is safe. Keep signed month-change basis points as BigInt through calculation and formatting; bounded Payment Mix basis points may remain safe integers.
- Recharts is safest as a narrow client rendering boundary over already-derived immutable datasets. Exact textual summaries, Cash/Card rows, status words, and disabled chart animation make the financial meaning independent of SVG geometry, color, or motion.
- Native month inputs expose browser-specific picker glyphs. When the canonical control supplies its own Calendar and Chevron, hide only the native glyph and invoke `showPicker()` from the user gesture so keyboard/native picker behavior remains available without duplicated visuals.

## 2026-08-20 - Canonical UI parity

- Treat Figma dimensions as breakpoint targets rather than universal fixed sizes: explicit desktop grid tracks can reproduce the 1440px frame, while bounded flexible tracks and deliberate stack breakpoints prevent the same geometry from overflowing at 1280px and below.
- Presentation pagination belongs after the application-owned filter/sort result. Clamp or reset the visual page whenever that source result changes so pagination cannot manufacture an empty data state.
- Canonical custom controls must retain native semantics in their interactive hit area. Visually transparent radio/checkbox inputs can cover the styled tile or segment, preserving keyboard behavior, focus indication, and reliable label activation without decorative div semantics.
- Receipt preview failure is a presentation state, not data corruption. Keep the stored Blob untouched and replace only the failed image rendering with a controlled, dimensionally stable fallback tile.
- Cross-provider binary retention is recoverable when content deletion happens before a conditional metadata transition, missing content is idempotent success only inside the authorized workflow, and terminal states are compare-and-set outcomes that no concurrent actor may overwrite.
- Visual parity needs measured browser geometry and direct screenshots in addition to green tests; canonical, intermediate, and narrow widths expose different failures, particularly implicit grid minimums and action-row overflow.

## 2026-08-22 - Dashboard analytics hierarchy correction

- A full-width primary chart needs both the outer grid span and explicit `min-width: 0` on grid children; otherwise an inner chart minimum can still create a desktop scrollbar even when the parent appears fluid.
- Supporting analytics cards need breakpoint-specific composition: two columns with the compact Payment Mix spanning below at tablet/laptop widths, then `1fr 1fr 0.8fr` on wide desktop. A compact legend should stack percentages under amounts when the payment card becomes narrow, preserving readable exact values without changing the analytics result.
- Visual inspection exposed issues automated geometry alone missed, including clipped Payment Mix percentages and mobile tick collisions. Screenshot review plus bounding-box assertions are both needed for responsive financial cards.

## 2026-08-22 - Attention badges, filter sizing, hydration resilience

- Shell attention counts must derive from the household access projection at the shell boundary instead of one session counter hard-coded to one href; the frozen badge rule already covered leader join requests, and hard-coding silently dropped them. Generalize count/label per destination when adding badges.
- Canonical fixed-pixel desktop tracks truncate variable-length financial labels while over-sizing short ones. Control rows should use content-driven `minmax()` tracks with an intrinsic (`auto`) action button so every control hugs its text.
- This machine force-loads browser extensions into every Chromium instance (including Playwright's clean profile), which injects pre-hydration DOM attributes such as `style="translate: ..."` on fixed elements and `cz-shortcut-listen` on `<body>`. No app code can prevent this; the React-endorsed mitigation is a narrowly scoped `suppressHydrationWarning` on exactly the affected elements (mobile nav bar, root body), keeping all child checking intact.
- A manually started dev server and tooling that assumes another origin (Playwright config uses `127.0.0.1`, default `next dev` serves `localhost`) collide: Next.js 16 blocks "cross-origin" dev chunks, pages render HTML but never hydrate, and every readiness-gated e2e test fails with the runtime stuck on `loading`. Let Playwright manage its own server or match hostnames exactly.

## 2026-08-22 - Canonical frame heights vs dynamic form panels

- Pinning variable-content panels to canonical-frame pixel `height`s reproduces the mock exactly for one state but fails every other state: shorter content leaves dead space inside the surface while taller content draws outside its border because overflow stays visible. Form panels whose children depend on user choices (payment method, receipt count, participant count) must size from content; treat Figma geometry as a breakpoint target, never as a fixed height.
- Geometric regression checks catch this class deterministically: compare every descendant rect against its panel rect at the canonical width in both toggle states, and assert the panel height responds to state changes instead of asserting one snapshot value.
- `rounded-xl` resolves to `--radius-card` (20px), which reads as a circle on small icon controls. Small controls need `rounded-md` (12px), which also matches the brand tile when a revealed control must adopt the logo's exact rectangle geometry in place.
- Reveal interactions that animate scale or transform drift visually from their anchor. In-place hover/focus reveals over a fixed element should crossfade opacity only and share the anchor's box, so nothing appears to move; assert with computed styles (`transform`, offsets versus the anchor rect) rather than screenshots alone.

## 2026-08-23 - Phase 12 re-hardening pass

- Enter animations that lower opacity (`animate-in` + `fade-in-*`) make text fail WCAG contrast for their duration: an Axe snapshot racing a 300ms metric fade measured #cccccc-on-white at 1.6:1 on an otherwise AA palette. For text values, keep entrance motion transform-only (`slide-in-from-*` without `fade-in-*`, whose absence leaves enter opacity at 1); never treat "the animation finishes quickly" as compliance.
- Post-checkpoint feature drift accumulates silently against frozen gates: one summary card missed the fixed-height-to-floor conversion because the conversion was applied per-edit rather than swept by selector. When a pass changes a mechanical pattern, enumerate all occurrences first (grep) instead of editing known instances.
- Row-direction flex wrappers shrink block children to content width, silently breaking inner grid right-edge alignment (expense amounts). When converting a container to flex for centering, switch to `flex-col` so existing children keep stretching horizontally.

## 2026-08-22 - Review-driven hardening corrections

- Every mutating application service path must route through the atomic persistence port; even "simple" profile edits need transaction-time re-reads, OCC, and uniqueness checks because IndexedDB unique indexes alone surface raw ConstraintError instead of typed conflicts.
- Error-code vocabulary is API surface: format-validation failures deserve their own typed code so callers can distinguish bad input from state conflicts without parsing English messages; when widening codes, sweep every test asserting the old generic code.
- When an owner requests work that contradicts a documented lesson (Card audit omission), surface the lesson and obtain an explicit decision first; the reaffirmed skip is cheaper than unwinding a model change to the Household-scoped audit store.
- A frozen "no browser-triggered cleanup" rule can be amended by owner approval into a narrow bootstrap sweep: keep the trigger inside privileged infrastructure, reuse the deterministic idempotent workflow unchanged, log failures non-fatally, and record the amendment in REQUIREMENTS.md before implementing.

## 2026-08-26 - R2 provider-transaction semantics (live-verified)

- Appwrite TablesDB transactions assign their own handles: `createTransaction` ignores client-supplied ids. Commands must adopt the returned `$id` per request; deriving handles from command ids is meaningless.
- Staged writes are visible only through transaction-scoped reads (`transactionId` on get/list); outside observers see committed state. Read-your-own-writes is the basis for in-transaction revalidation.
- Commit-time conflict detection exists and is optimistic-first-committer-wins: a second transaction touching an underlying row changed since staging fails with 409 `transaction_conflict`. This composes with - never replaces - application-level OCC, guard pre-checks, and idempotency.
- Unique-index violations surface at COMMIT as the same 409 `transaction_conflict`, not at staging; typed errors therefore need in-tx pre-checks plus post-conflict outcome re-reads (e.g., idempotent replay) to translate precisely.
- TTL is bounded (60-3600 s); expired handles reject staged ops and commits with 410 `transaction_expired`. Keep transactions short, retry expired units once with a fresh handle, and stage nothing across user interaction.
- The operation limit (exactly 100 on Free) is enforced fail-fast when staging the 101st operation, so deletion-math safety can be asserted structurally as well as measured (`tx.stagedOperations()`).

## 2026-08-27 - R3 financial command delivery

- Lost-response replay lookup must precede stale-version, missing-row, deleted-row, or terminal-state prechecks. Otherwise a committed delete or transition can no longer return its original outcome when the same command is retried.
- Membership and leadership transitions that change financial authorization must touch the same per-Household financial guard as Expense and Settlement writes. Transaction-scoped membership rereads alone do not serialize a concurrently staged authorization change.
- Private Card association identity belongs in the internal Expense financial fingerprint even though it must not appear in shared presentation. Without it, switching between two private Cards can be misclassified as a non-financial edit.
- Measure transaction write envelopes with the provider-faithful test double, including upserts and every guard, private row, audit, and outcome. R3's observed maximum is seven operations for Card A -> Card B Expense edit, not the nominal business-row count.

## 2026-08-30 - v1.1 allowlisted authentication

- Ordinary self-signup belongs on a keyless Appwrite Account client behind the trusted same-origin boundary; adding a Users-admin credential to the Site runtime would unnecessarily broaden authority and couple normal account ownership to provisioning tooling.
- Appwrite Auth account creation and TablesDB Profile bootstrap cannot be atomic. Create Auth first, immediately attempt the existing idempotent `ensureProfile`, and preserve trusted login/restore repair so a transient Profile failure never motivates deleting or recreating a production identity.
- Password mutation is actor classification, not just credential validation: derive the session only from the HttpOnly cookie, re-check the approved email before mutation, call `Account.updatePassword` on the session client, and clear the local cookie afterward regardless of provider session-invalidation policy.
- Authentication error logging should record only a safe failure class/name. Even when request payloads are never logged directly, forwarding raw provider messages creates an avoidable path for credential-like values to enter operational logs.
- A production throttle proof consumes the real proxy-derived source-IP bucket even when the test sends a synthetic `x-forwarded-for`; Appwrite Sites correctly replaces the untrusted value. If a release stop boundary requires a later signup from that source, identify and remove only the newly created HMAC-opaque QA guard after proving 429, with exact-row assertions and post-cleanup verification.
