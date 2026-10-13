# Approved visual direction — local implementation plan

## Status and authority — implementation 2026-10-11/12

The owner's subsequent U1 refinement request supersedes expandable-sidebar provisions: use a permanently compact rail, centered page containers, a shared notification bell beside the header Profile control, corrected Dashboard spacing and animated navigation selection. [ACTIVE_PLAN.md](ACTIVE_PLAN.md) records this local presentation phase; its implementation evidence will be recorded separately from the original R7 results. Financial/product behavior and the separate production-release gate remain unchanged.

**Local implementation delivered; final local acceptance evidence is recorded separately.** After approving the generated direction and this plan, the owner explicitly requested implementation across web/mobile, animation and local verification with unchanged functionality and no automatic production deployment. The earlier planning-only status is superseded by that request. R0–R6 are implemented; R7 engineering results, screenshots and explicit verification limits are recorded in [UI_REDESIGN_VERIFICATION_2026-10-12.md](UI_REDESIGN_VERIFICATION_2026-10-12.md). Owner visual acceptance remains against the running local app; R8 is not authorized.

The implementation request authorizes sequential local R0–R7, with verification between phases recorded in [ACTIVE_PLAN.md](ACTIVE_PLAN.md). R8 remains a separately authorized production release. The request to implement the complete design permits progression beyond the Dashboard pilot; final owner acceptance still occurs against the running local app.

The authoritative product contract remains [REQUIREMENTS.md](../REQUIREMENTS.md). The approved new visual direction supersedes appearance only, subject to the presentation amendment in R0. Generated pictures supply composition, styling and hierarchy; current requirements and tested code supply every operation, value, permission and state. If an image omits an existing action or shows an invented one, retain the existing action and omit the invented one. Never copy generated sample numbers into runtime data.

## Non-negotiable scope

- Change presentation, layout and motion only. Keep routes, redirects, commands, payloads, validation, permissions, financial calculations, persistence, history, filters, ordering, confirmations and error/retry behavior equivalent.
- Preserve exact integer-poisha arithmetic, deterministic allocations, all three split modes, zero-share participants, immutable payer, current Expense date policy and existing settlement/history locks.
- Preserve owner-only Card metadata, active-member Receipt reads, creator-only Receipt mutations, avatar privacy, pre-acceptance Household privacy and recipient-isolated notifications. Styling cannot replace authorization or broaden a projection.
- Preserve single-submit protections, OCC, command IDs/idempotency, authoritative confirmation, successful-mutation/failed-refresh distinction and explicit retry for uncertain writes. Animation cannot create, repeat, delay or cancel a business command.
- Preserve mounted drafts during transient session recovery. Logout, identity changes and protected-request 401 must clear private content immediately; no exit animation or retained browser snapshot may keep it visible. A 403 remains a denial, not an assumed logout.
- Keep the existing local IndexedDB and production Appwrite compositions separate. No schema migration, data conversion, provider permission/configuration change, new API or additional paid service is part of this redesign.
- Preserve the existing uncommitted M1–M3/P1–P4 maintenance. Establish the redesign baseline from the current working tree, not HEAD alone. Do not reset, discard, commit, push or deploy that work under this planning request.
- The separately documented 5,001-row provider overflow finding is outside this plan. Do not fix it incidentally; its behavior change still needs separate owner approval.

## Visual references and complete coverage

The 22 approved PNGs are in the local [concept folder](C:/Users/raiya/.codex/generated_images/01a12bc8-e6c4-7172-a897-a5ef171b9cea/house-finance-ui-concepts-v1). The [ZIP](C:/Users/raiya/.codex/generated_images/01a12bc8-e6c4-7172-a897-a5ef171b9cea/house-finance-ui-concepts-v1.zip) preserves the set. Original inspiration: [Customer Journey CRM Dashboard](https://dribbble.com/shots/24659454-Customer-Journey-CRM-Dashboard); the supplied reference screenshot and approved project concepts are the visual evidence already inspected, rather than inferred page content.

| Concept files | Current route / view | Delivery phase |
| --- | --- | --- |
| 01-dashboard | `/dashboard` | R2 |
| 02-expenses | `/expenses` | R3 |
| 03-add-expense | `/expenses/new` | R3 |
| 04-expense-details | `/expenses/[expenseId]` | R3 |
| 05-edit-expense | `/expenses/[expenseId]/edit` | R3 |
| 06-settlements | `/settlements` | R4 |
| 07-my-cards, 21-add-card-dialog, 22-edit-card-dialog | `/cards` and its dialogs | R4 |
| 08-household-leader, 18-household-no-membership, 19-household-pending-request, 20-household-member | Four access states of `/household` | R5 |
| 09-household-create, 10-household-join | `/household/create`, `/household/join` | R5 |
| 11-profile | `/profile` | R5 |
| 12-notifications | `/notifications`, Dashboard bell | R5; bell shell styling in R2 |
| 13-monthly-report | `/reports/monthly?month=YYYY-MM` | R5 |
| 14-sign-in, 15-sign-up, 16-forgot-password, 17-reset-password | `/login`, `/signup`, `/forgot-password`, `/reset-password` | R6 |

Also preserve `/` → `/dashboard` and `/register` → `/signup`; these redirects do not become new screens.

R0 inventories **all additional existing states**, including loading, empty, error, unavailable, permission denial, validation, pending, success, disabled and stale results. Coverage includes Expense deleted/locked/former-member/legacy-percentage states, backdated confirmation, receipt preview/upload/removal/expiration, comments, no/archived Cards, Card delete-versus-archive confirmation, Settlement request/confirm/reject/cancel and stale warnings, Household rename/accept/reject/cancel/remove/transfer/leave/delete confirmations, Profile photo/password controls, notification pagination/read actions, runtime retry/recovery, password visibility, tooltips, selectors and mobile More. Each remains functional even when absent from its picture.

## Design system and technical approach

- Match the approved pearl-gray canvas, subtle blue-gray lower wash, black selected navigation pills, near-white inset panels, pale grouped parent surfaces, restrained shadows, generous spacing and rounded 24–32px large surfaces. Use the characteristic centered avatar notch where it fits the reference; it is decorative and must not clip names, targets or focus rings.
- Retain Inter, readable tabular money, existing category assets/credits, Lucide vocabulary, authorized Profile images and initials fallbacks. Do not introduce generated faces or external avatar requests. Blue/coral chart styling must preserve accessible labels and truthful data.
- Desktop: horizontal primary navigation and compact account/navigation rail following the concepts. Preserve the five destinations, active-route rules, settlement/join-request badges, Profile, role, Logout and separate development tools. Preserve accessible rail expansion/collapse with session-only state and the existing hover/focus reveal semantics; adapt its geometry to the new shell rather than dropping the feature.
- Below 1024px: retain Dashboard / Expenses / Add / Settlements / More and existing More destinations/account controls, safe-area spacing and capabilities. Reflow the desktop concepts into readable mobile cards and single-column forms. At 1024px, all desktop destinations must still fit and remain reachable.
- Dashboard retains the month selector, authorized member avatars, screen-reader heading, all current metrics and report entry point. Monthly data and current balances remain distinct. Reports stay outside primary navigation; the bell stays on Dashboard. No new shortcuts, filters, settings or actions inferred from the inspiration.
- Use existing Tailwind, shadcn/Radix, `tw-animate-css`, Sonner and Recharts. Start with CSS motion tokens and small presentation helpers where necessary; no animation package or framework upgrade is required.
- Primary implementation seams: `src/app/globals.css`, `src/components/ui/*`, `src/presentation/shell/*`, existing feature presentation components, and presentation-only route/layout markup. Keep domain/application/infrastructure/API/provider modules outside the redesign patch. If a presentation change appears to require changing their behavior, stop and document the dependency before proceeding.
- Preserve component contracts: native buttons/links/inputs, `Button` server compatibility, `asChild`, forwarded props, form registration, `type`, handlers, refs and ARIA. Keep Expense parent state, extracted section props and Receipt URL ownership intact. Do not replace working form logic to make it easier to animate.
- Before implementation reread applicable bundled Next.js docs, especially `01-app/02-guides/view-transitions.md`, `01-app/01-getting-started/04-linking-and-navigating.md`, and `03-architecture/accessibility.md`. These installed-version guides govern API choices.

## Motion specification

These are initial tuning targets, not waits inserted into business operations. Every enabled clickable operation gets visible feedback through its actual shared control or an explicitly inventoried custom/native control. Disabled operations remain inert. Keyboard and touch activation receive equivalent feedback; hover effects are optional on touch.

| Interaction | Motion / feedback target | Functional safeguard |
| --- | --- | --- |
| Button or icon-button press | 80–100ms press, 120–150ms release; about 1px movement or scale 0.98 | Invoke existing action immediately and exactly once; keep focus/target stable |
| Hover, selected pill, checkbox/radio/design choice | 150ms color/border or decorative indicator movement | Checked/selected state updates immediately; no animated financial interpolation |
| Field focus and validation | Immediate focus ring; restrained 150ms border change | Keep existing error text, association and validation timing; no shaking input |
| Dropdown, tooltip, popover, calendar | 150ms, small 2–4px movement | Preserve keyboard order, placement, focus and disabled dates |
| Dialog / mobile sheet | 200ms dialog or 250ms sheet movement; backdrop may fade | Preserve existing confirmation and focus trap/return; no action waits for exit |
| Page navigation | 200ms arrival, about 4–6px movement of the new content; 150ms active-pill feedback | Existing Link/router handles navigation immediately; no blocked exit sequence |
| Successful operation / new row / existing toast | 150–200ms subtle movement or border feedback after authoritative outcome | Success appears only after real success; preserve partial/unknown outcomes and error drafts |
| Loading / pending operation | Existing pending label/spinner; dimensionally stable loading surface | Pending state reflects the actual operation; no artificial progress or success |
| Sidebar expansion/collapse | About 200ms geometry transition | Same route, actions and session collapse state; no layout overflow |

**Accessibility constraints:** Keep all readable text and financial values at full opacity throughout entrance transitions. The existing AI lesson records a contrast failure from text fades. Fade decorative/backdrop layers only, and maintain contrast at every state. No money count-up, animated chart data, looping decoration, broad stagger or flashing feedback. Existing Recharts data animation stays disabled.

`prefers-reduced-motion: reduce` removes movement, scaling, animated geometry and smooth scrolling; use immediate color/border changes and a readable pending label. Maintain focus visibility and all operation feedback without motion.

**Route implementation:** Animate the arriving route surface after the actual committed route change without keying/remounting the runtime, form or feature subtree just to replay an effect. Preserve existing identity/ownership remount boundaries, scroll/back/forward behavior, route announcer, focus management and Link prefetch settings. No click interception, manual navigation queue, duplicate bootstrap/read, or deferred redirect. Avoid private-content exit snapshots. Native React ViewTransition is available in the installed App Router, but is not required; any later use must first prove equivalent privacy, reduced-motion and browser behavior. Simple CSS arrival motion is the planned default.

Prefer transforms and decorative opacity; avoid animating large blur/shadow/filter layers or using `transition: all`. No motion timer may own command completion, cleanup or authorization.

## Sequential delivery phases

### R0 — Freeze the baseline and presentation contract

**Outcome:** reviewable baseline and complete coverage checklist before UI edits.

1. Preserve and identify current maintenance changes; capture current tree/diff and relevant file hashes as the redesign comparison baseline. Use synthetic fixtures, never exported real financial data.
2. Record a narrowly labeled `REQUIREMENT CHANGE — presentation only` in REQUIREMENTS when implementation is authorized: new desktop shell, surfaces, palette/radii and motion. Retain every business rule and existing operation listed above. Resolve any omitted mock control through preservation, not removal.
3. Create a portable visual-reference manifest with filenames/hashes and stable local copies for implementation review; do not import these PNGs as runtime page backgrounds. Record which states each picture does not cover.
4. Capture current desktop/mobile screenshots, action/state inventory, command-count/payload expectations for critical fixture journeys, route behavior, bundle size and repeatable navigation measurements.
5. Rerun current unit/architecture/static/build and critical local browser checks to establish fresh evidence. Existing recorded maintenance results are 919/919 Vitest tests and 78 passing critical browser cases, with one Windows WebKit Receipt persistence skip; these are context, not a fresh redesign test result.

**Exit:** baseline is reproducible, all routes/actions/states are mapped, and the presentation amendment preserves functionality. Only then enter R1.

### R1 — Shared surfaces, controls and motion foundation

**Outcome:** reusable visual tokens and interactions that other pages can adopt.

Update colors, grouped/inset surfaces, typography, spacing, radii and responsive rules. Implement motion/reduced-motion tokens and shared Button, icon control, input, selector, dialog, sheet, popover and toast styles. Inventory raw/custom controls so no button operation is accidentally left out. Keep global tokens coherent while existing pages are migrated; avoid parallel theme implementations.

**Verification/exit:** focused control/keyboard/form tests, contrast during motion, reduced-motion checks, unchanged handler/submit/disabled/asChild contracts, TypeScript and zero-warning lint. No business-layer diff.

### R2 — Responsive shell and Dashboard pilot

**Outcome:** a working local example faithful to the approved dashboard.

Implement desktop header/rail, accessible collapse, badges/account/dev controls, existing mobile bottom navigation and safe-area behavior. Add route arrival motion and Dashboard grouped composition using the current projections and all metrics. Keep month retention, zero-spend states, chart summaries and report/bell access working.

**Verification/exit:** compare local screenshots with `01-dashboard.png`; exercise five navigation destinations, deep links/back/forward, collapse, mobile More, month changes, notification bell and identity/session invalidation. No extra reads or lost state caused by motion. The owner's complete implementation request authorizes extension across feature pages after local pilot verification; owner acceptance remains the R7 exit gate.

### R3 — All Expense screens and states

**Outcome:** list, create, details and edit match concepts 02–05 with every existing operation intact.

Restyle filters, sort, desktop rows/mobile cards, pagination, details/history, all split/payment/participant controls, category selector, date picker, summaries, receipts and comments. Preserve name-only search, filter defaults/order, Settlement and Comments columns, staged edits/Cancel, locked/deleted/former-member/legacy states, non-owner leader Card restrictions, date/backdated confirmations and concurrent-save recovery.

**Verification/exit:** meaningful existing Expense/parity/privacy tests plus critical browser journeys for Equal/Amount/Percentage, exact allocations, receipt cancel/save, locked/stale edits and double activation. Identical commands, persisted values, balances and permissions for the same fixture operations before/after. Screenshot review covers expanding forms and validation, not just ideal empty fields.

### R4 — Settlements and private Cards

**Outcome:** concepts 06–07 and 21–22 implemented locally.

Restyle recommendations, pending actions/history, external-payment confirmations, stale warnings, Card lists, all six design previews, Add/Edit and Delete/Archive confirmations. Decorative demo Card numbers/expiry remain constants, never input or payload fields. Do not animate debt values or infer new payment capabilities.

**Verification/exit:** sender/receiver lifecycle, immutable confirmed history, unordered Pending-pair duplicate protection, original snapshot amount, private Card visibility, historical references and archive-versus-delete race checks pass. Micro-animation never displays confirmation before the command succeeds.

### R5 — Household, Profile, Notifications and Monthly Report

**Outcome:** concepts 08–13 and 18–20 plus unpictured dialogs covered.

Restyle all four Household states, Create/Join, code Show/Hide/Copy, management and rename. Restyle Profile name/photo/password controls with unchanged runtime capabilities, notification read/pagination actions and monthly analytics. Preserve each role/capability gate, leading-zero codes, membership obligations, safe snapshots, month retention and former-member report inclusion.

**Verification/exit:** role/access-state matrix, required destructive confirmations, pre-acceptance privacy, zero-balance/Pending membership gates, notification recipient/read behavior, Profile draft/URL cleanup and report totals/month semantics pass. Real password/account actions are not performed for local visual review.

### R6 — Auth presentation and complete interaction sweep

**Outcome:** concepts 14–17 and every remaining control share the design and motion language.

Restyle Login, Signup, recovery and reset views without changing fields, redirects, allowlist, password-manager semantics, visibility controls or session contracts. Exercise production-only auth/Profile/session behavior locally using intercepted fixtures, complementing IndexedDB business journeys; do not fabricate local password auth or call production accounts. Sweep every inventoried action across desktop/tablet/mobile for press, pending, result, error and reduced-motion feedback.

**Verification/exit:** local auth/session fixture tests show unchanged commands, validation, redirects, draft retention, successful-write/failed-refresh handling and immediate private-content clearing. All 22 concepts and additional existing states have reviewed screenshots; no uncovered button operation or route transition remains.

### R7 — Integrated local acceptance

**Outcome:** a locally accepted release candidate with evidence of visual and functional parity.

Run the gates below, inspect screenshots at 360/390/768/1024/1440/1920px and 200% zoom, and cover long names, large amounts, empty/high-volume datasets, expanded forms and permission/error states. Fix visual defects inside the presentation scope and rerun affected checks. Record a concise parity report, reviewed screenshots, animation coverage, performance comparison and known host limitations. Update PROJECT_STATE and ACTIVE_PLAN after each completed phase.

**Exit:** all applicable gates pass and the owner accepts the running local app. Local success permits preparation of a production proposal; it does not deploy or authorize live mutations.

### R8 — Production proposal and separately approved rollout

**Entry:** R7 accepted locally and explicit release authorization.

Prepare the isolated redesign diff, explain its relationship to the uncommitted maintenance, and select the reviewed release revision. Verify clean-install/CI, existing strict dependency audit, actual production build/runtime configuration and current production rollback revision. No migration or data transformation should exist. Treat pushing as release-sensitive because current CI runs on pushes and production integration may deploy commits.

Present the concrete release candidate and rollback steps for approval before deployment. After authorized deployment, perform approved read-only/navigation acceptance with existing accounts; account/password/financial/provider mutations need their own authorized test scope. On a material regression, revert the application revision through the approved rollback procedure; UI rollback must not modify financial data. Record actual activation and post-release evidence without claiming an unavailable provider status was verified.

## Verification and release gates

| Gate | Required evidence |
| --- | --- |
| Functionality | Same available actions, validations, defaults, commands/arguments/counts and final persisted fixture state; unchanged exact allocations/balances/history across critical journeys |
| Scope | Redesign-only patch confined to presentation, relevant UI tests and docs; existing maintenance identified separately; no schema/provider/domain/API behavior change |
| Interaction | Click/touch/keyboard, rapid double activation, pending/result/error/cancel/retry and every current dialog checked; navigation adds no wait or state loss |
| Privacy/recovery | No private Card/Household/avatar leakage; immediate clearing on 401/logout/identity switch; retained drafts during transient recovery; no auto-replayed mutation |
| Accessibility | Zero serious/critical Axe findings in covered states; AA contrast throughout animation, visible focus, keyboard dialogs, chart text, approximately 44px important targets, reduced motion and 200% zoom |
| Responsive visual quality | Approved composition at desktop; intentional mobile/tablet reflow; no page overflow, clipped focus or covered actions; dynamic content fits parent panels |
| Performance | Same deterministic request counts; measured before/after bundle and navigation cost; no new animation dependency, artificial action delay or persistent layout jump; investigate any material regression before acceptance |
| Engineering | Full Vitest/architecture, zero-warning lint, TypeScript, local-composition production build, applicable isolated browser suites and whitespace checks pass |
| Release | Owner accepts local app; reviewed immutable candidate, fresh CI/audit evidence, captured rollback revision and separate deployment authorization |

### Local verification commands

Run in dedicated shells so test-specific environment values do not leak into ordinary development. Ensure no remote `PLAYWRIGHT_BASE_URL` is set; critical configuration already rejects it. Let Playwright manage its server rather than reusing an incompatible composition/origin.

```powershell
$env:APP_COMPOSITION = 'local'
npm test
npm run test:architecture
npm run lint -- --max-warnings=0
npm run typecheck
npm run build
$env:HFT_CRITICAL_E2E = '1'
npx playwright test tests/e2e/household-onboarding.spec.ts tests/e2e/household-management.spec.ts tests/e2e/expenses.spec.ts tests/e2e/settlements.spec.ts tests/e2e/cards.spec.ts tests/e2e/ui-redesign.spec.ts --workers=2
git diff --check
```

In a separate local shell, run the intercepted production-session suite with no live provider credentials or remote base URL:

```powershell
$env:APP_COMPOSITION = 'appwrite'
$env:SESSION_RESILIENCE_E2E = '1'
npm run build
npx playwright test tests/e2e/session-resilience.spec.ts --workers=2
```

R0 verifies which existing analytics, notifications, shell/accessibility, Profile and auth specs are hermetic before selecting them. R1–R6 add focused tests only for meaningful interaction risks, including route transitions, reduced motion, keyboard/duplicate activation and privacy clearing; do not weaken existing assertions or run the whole browser directory blindly because it contains live-provider suites. Extend explicit cross-browser selection for new motion checks where needed, preserving existing test isolation. Recheck the known Windows WebKit Blob limitation and retain the Linux Receipt coverage; report a skip accurately.

The original planning task performed no implementation. The subsequently authorized implementation and its actual local evidence are recorded in ACTIVE_PLAN, PROJECT_STATE and the dated redesign verification report. Production remains unchanged.
