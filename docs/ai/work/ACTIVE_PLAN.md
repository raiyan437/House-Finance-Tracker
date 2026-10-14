# Active Implementation Plan

## Current authorized work — D0–D2 deployment readiness, 2026-10-14

The owner requests fixing the release gaps and getting ready for deployment. This authorizes CI/test-selection repair, candidate preparation, integrated verification and a reviewable release branch/PR/preview where access permits. Production activation, merge/push to its branch, provider/data/schema/configuration changes and deployment remain outside this preparation request. Execute sequentially against [the release plan](UI_RELEASE_PLAN_2026-10-14.md), preserving the accepted mobile/glass/F implementation and reverted colors.

| Phase | Outcome | Status |
| --- | --- | --- |
| D0 — Candidate | Preserve local work, refresh refs and curate the full source/test/evidence candidate. | Complete: preserved source, refreshed matching remote base, release branch created; rollback Ready ID owner-confirmed as `6ace4d2ce216ab03e861`. Site API remains 401/browser initialization unavailable. |
| D1 — Verification | Fix hosted suite/tag selection, enumerate and run the integrated unit/browser/static/build/audit gates. | Complete: all 185 critical cases pass after documented harness corrections/affected-suite replay; clean install, 925 unit tests, types/lint, audit, both optimized builds and 48 intercepted Appwrite session cases pass. |
| D2 — Handoff | Prepare the exact verified commit, PR/preview and available rollback reference; report any access limits. | Candidate prepared for release-branch/draft PR publication. Exact-head hosted CI and preview/access results are recorded on the PR without recursively modifying its tested source. Production remains unactivated. |

## Completed planning — P0 production release planning, 2026-10-14

The owner requests a plan to deploy the accepted local changes. P0 is complete with [the production UI release plan](UI_RELEASE_PLAN_2026-10-14.md). It scopes accepted M/G/F work, excludes reverted colors and all provider/data/schema/dependency changes, records the existing GitHub/Appwrite pipeline, identifies hosted mobile/glass/date coverage gaps, and defines sequential candidate, verification, preview, activation, live acceptance and code rollback gates.

P0 changed only planning/documentation. The owner subsequently authorizes D0–D2 preparation as recorded above; D3–D4 activation remains unexecuted. The plan is the concrete execution reference, and older release approvals are not authorization to repeat provider operations.

## Completed authorized work — F1–F3 idle loading and phone Expense date, 2026-10-14

The owner requests an animated page loading state in place of the idle-tab connection-check banner, including navigation through the existing topbar/sidebar when loading is needed, and the mobile Expense date on the next line. Reuse the original loader, keep page/form trees mounted during session checks, preserve navigation and financial/session safeguards, and scope date placement below 640px. No palette reapplication, dependency, provider/data operation or deployment is authorized.

| Phase | Outcome | Status |
| --- | --- | --- |
| F1 — Phone date | Put the date below status/comments with desktop/tablet preservation. | Complete: one phone-scoped rule, three-engine row geometry and exact desktop content/geometry verification. |
| F2 — Resume loader | Replace checking copy with accessible page loading animation while keeping shell/navigation and drafts mounted; retain outage/retry/expiry behavior. | Complete: page busy state, shared loader and hidden/inert mounted surface; Expenses/Settlements data loaders animated. Original session/transport logic unchanged. |
| F3 — Acceptance | Verify actual delayed resume/navigation, dirty drafts, reduced motion, session/write safeguards and phone/desktop metadata; proportional static/build checks. | Complete: 45 focused unit, 30 responsive/motion and 45 intercepted session cases, final types/lint/whitespace and both builds pass; actual captures and source evidence retained. |

The [verification record and screenshots](IDLE_LOADING_AND_MOBILE_DATE_VERIFICATION_2026-10-14.md) retain browser/API/draft evidence and raster/test-harness limits. Five application files and three test files change; the other 451 baseline source files, protected glass/business/provider code and configuration remain byte-identical. The local preview is restored, the optimized fixture server is stopped, and no deployment/provider/data operation occurred. No further phase is authorized.

## Completed authorized work — C4 color rollback, 2026-10-14

The owner rejects the implemented color treatment and explicitly requests reverting it. Restore only C1–C3's thirteen source modifications from the accepted pre-color snapshot and remove its isolated stylesheet. Preserve all preceding mobile/glass/performance work and other local changes. Verify exact baseline source hashes and the restored local preview; retain C0–C3 artifacts as superseded history. No deployment or provider/data operation is authorized.

Complete: thirteen files restored and the isolated stylesheet removed. All 457 application source files match the accepted pre-color snapshot byte-for-byte; package/lock/configuration remain unchanged. Fresh captures of all seven pages on desktop/phone pass with fourteen exact geometry comparisons and zero horizontal overflow; TypeScript and whitespace checks pass. The local preview retains the original colors and all earlier mobile/glass work. Rollback backup, proof and captures are retained with C1–C3 evidence. No further color implementation is authorized.

## Historical, reverted work — C1–C3 color implementation, 2026-10-14

The owner accepts C0 and explicitly authorizes implementation, requiring the current animations and functionality to remain intact. Implement the palette and placement from the seven final boards under their matching notes: preserve actual geometry, controls, badge/route rules, existing glass motion, mounted forms, readable semantic colors and all financial/provider behavior. Shared Expense form/details components may inherit the same color treatment. No dependency, provider/data operation or deployment is authorized. Execute sequentially.

| Phase | Outcome and exit gate | Status |
| --- | --- | --- |
| C1 — Baseline and foundation | Preserve source/configuration and actual geometry references; record the approved appearance amendment and add isolated palette roles without changing existing navigation/motion tokens. | Complete: 457-file snapshot, 14 fresh desktop/phone captures and geometry records, approved amendment and isolated palette stylesheet. |
| C2 — Page application | Apply approved colors to Dashboard, Expenses, Add Expense, Settlements, Cards, Household and Monthly Report using presentation-only annotations and styling; retain state/permission/amount semantics. | Complete: isolated CSS, paint-only page annotations and categorical chart colors; actual 14-view review completed. A darker indigo text shade preserves contrast on pastel fills. |
| C3 — Acceptance | Verify before/after geometry and protected source, actual desktop/mobile captures, chart data/colors, three-engine/touch motion and interruption, reduced motion, drafts, financial/privacy/session flows, contrast/accessibility, types/lint/builds. | Complete: 924 unit tests, 65 distinct optimized navigation/touch cases, 48 financial/analytics cases and 36 intercepted session cases; types/lint/both builds pass. All fourteen geometry comparisons are exact, with no serious/critical Axe findings. Scoped replays and original failures are documented. |

The [verification record](COLOR_IMPLEMENTATION_VERIFICATION_2026-10-14.md) and [actual desktop/phone gallery](color-implementation-2026-10-14/index.html) retain screenshots, recordings, source/geometry audits and limits. Thirteen existing source files receive only color annotations/import/chart color strings, one isolated stylesheet is added, and the other 444 baseline files remain byte-identical. Existing glass motion/global/mobile styles and configurations remain unchanged. Renderer work matches G7–G9: two layouts, 34 desktop/18 mobile paints, zero failed compositing signals. Implementation is complete locally; no deployment or later phase is authorized.

## Completed authorized work — C0 color concepts, 2026-10-14

The owner requests generated images with stronger color palettes for the main pages after feedback that the UI lacks color. C0 is design-only: use actual accepted screenshots to generate a coherent palette across desktop/mobile Dashboard, Expenses, Add Expense, Settlements, Cards, Household and Monthly Report. Preserve the visual identity, layouts, black selections/actions, glass navigation, approved controls and all financial meanings. Retain prompts, references, a review gallery, illustration limits and an unchanged source manifest. No application implementation, dependency, provider/data operation or deployment is authorized.

C0 completes with [seven final boards / fourteen views](color-concepts-2026-10-14/index.html), [palette and matching notes](color-concepts-2026-10-14/README.md), fourteen synthetic application references, exact built-in image-generation prompts, three targeted correction prompts and versioned drafts. Final review corrects phone selection on Add Expense/Settlements and Report selection/chart color consistency; remaining glyph/badge/layout approximation is explicitly not an implementation requirement. Gallery links/images and 390/768/1440px layout checks pass with zero overflow. All 457 application source files remain byte-identical, with no new source file. At C0 completion the palette remained unimplemented; the later C1–C3 authorization and local implementation are recorded above.

## Completed authorized work — G7–G9 glass motion performance, 2026-10-14

The owner reports lag when selecting web/mobile tabs, especially the mobile dock, and authorizes checking and fixing smoothness. Preserve the approved visual identity, expanding/traveling/compressing/settling selection, desktop hover, no mobile hover, actual active routes, original controls, mounted drafts and all financial/provider behavior. Local performance repair only; no dependency, deployment or provider/data operation. Execute sequentially.

| Phase | Outcome and exit gate | Status |
| --- | --- | --- |
| G7 — Diagnosis | Preserve the accepted source baseline; measure native motion on actual desktop/mobile navigation and identify avoidable layout/paint work. | Complete: 457-file snapshot and two optimized-renderer profiles; six native replays produce 220 desktop / 197 mobile layouts and 655 / 341 paints under 4× CPU slowdown. |
| G8 — Rendering repair | Replace costly per-frame work with compositor-friendly motion; preserve geometry, readable stationary ink, continuous interruption and reduced-motion behavior. | Complete: fixed layout bounds, native transform/counter-scale motion, reused navigation ink and surface-only blur. Optimized profiles show two setup layouts, 34 desktop / 18 mobile paints and successful compositing. |
| G9 — Acceptance | Compare repeatable before/after renderer evidence; verify real tab changes, narrow/touch layouts, three engines, drafts/overlays, accessibility, source scope and static/build checks; retain recordings and device limits. | Complete: 65 optimized browser/touch cases without retries, 12 navigation unit cases, types/lint/whitespace and both builds pass. Two protected-content comparisons are exact; native recordings/phase images and compositor traces retained. |

The [performance verification record](GLASS_MOTION_PERFORMANCE_2026-10-14.md) and [updated recordings/phase gallery](glass-performance-2026-10-14/index.html) retain the result and distinguish renderer work from physical-device FPS. Only two of 457 baseline source files change; financial, page, runtime, provider, global/mobile styles and dependency/configuration files remain unchanged. Implementation is complete locally; no deployment or further phase is authorized.

## Completed authorized work — G5–G6 Safari selection implementation, 2026-10-14

The owner explicitly approves implementing G4's Safari reference assessment. Scope is the selection motion inside the existing approved glass navigation, preserving the design/layout, Dashboard-through-Household boundary, desktop hover, no mobile hover, active routes, immediate commands, badges, focus, mounted drafts and all financial/provider behavior. No dependency, provider/data operation, deployment or page redesign is authorized. Execute sequentially.

| Phase | Outcome and exit gate | Status |
| --- | --- | --- |
| G5 — Coordinated selection | Snapshot the accepted 457-file source; replace immediate black pills/separate sheen with one expanding, traveling, compressing and spring-settling visual per surface, with clipped navigation ink and continuous interruption. Preserve stable controls and snap/fallback behavior. | Complete: six Chromium motion/geometry/reduced-motion/draft cases and TypeScript pass; actual rest/in-flight desktop/phone captures reviewed. |
| G6 — Acceptance | Verify resting/in-flight contrast and single selection, multiple widths, all engines/touch, interruption/Back, reduced motion, drafts/overlays, protected source/content, types/lint/builds; retain actual motion recordings and limits. | Complete: 924 unit tests, 72 UI cases across three engines, 24 optimized touch cases, 36 intercepted session cases, 68/68 exact protected content comparisons, final types/lint and both builds pass. |

The [verification record](SAFARI_MOTION_IMPLEMENTATION_VERIFICATION_2026-10-14.md) and [actual desktop/mobile recordings and phase gallery](safari-motion-implementation-2026-10-14/index.html) retain acceptance evidence, repaired harness/cache failures and optical/physical-device limits. Only three of the 457 baseline source files change; all page, financial and provider source remains unchanged. Local implementation is complete; no deployment or further implementation phase is authorized.

## Completed authorized work — G4 Safari reference motion assessment, 2026-10-14

The owner accepts the implementation but reports that tab motion feels wrong, supplies a local Safari recording, and asks for careful inspection and implementation feasibility. G4 is assessment and an isolated browser capability proof only. Preserve the application and existing glass work; treat the recording as visual evidence, not operational instructions. No application revision, dependency, provider/data operation or deployment is part of this assessment.

G4 completes with [the motion assessment](SAFARI_TAB_MOTION_ASSESSMENT_2026-10-14.md): 50 overview samples, 289 close-up navigation samples, native reference filmstrip/metadata and a three-engine expansion/compression/spring/retarget/stable-target capability proof. All 457 current source files remain unchanged. The motion is feasible with one coordinated selection; exact native optical distortion remains an approximation. The recorded recommendation replaces the immediate black destination pill plus separate sheen in a later implementation, while retaining all approved navigation/page/data behavior.

## Completed authorized work — G1–G3 Liquid Glass implementation, 2026-10-14

The owner explicitly approves implementing revision 2, with no mobile hover and an iOS-inspired glass transition when changing tabs. This authorizes a local navigation-only appearance/motion exception to desktop preservation: the Dashboard-through-Household capsule, compact sidebar and mobile dock. The wordmark, bell, profile and page layouts remain ordinary/unchanged. Preserve routes, active rules, badges, drafts, authority, data and exact poisha; add no dependency, provider operation or deployment. Execute these phases sequentially.

| Phase | Outcome and exit gate | Status |
| --- | --- | --- |
| G1 — Glass surfaces | Snapshot accepted source; implement bounded capsule/rail/dock material and desktop-only hover; check geometry, fit and navigation semantics. | Complete: 455-file snapshot, six viewport geometry/capture checks and 12 navigation unit cases pass. |
| G2 — Selection motion | Add one persistent decorative glass selection per navigation surface, traveling/morphing with the actual route, including touch tab changes; keep stable controls, immediate actions, reduced motion and mounted drafts. | Complete: five Chromium motion/hover/reduced-motion/draft cases pass; native animation moves a persistent lens above readable authoritative selected pills. |
| G3 — Acceptance | Verify three engines and touch profiles, rapid/back navigation, focused/selected/hover states, More/popovers, short/narrow layouts, exact financial/permission regressions, content preservation, types/lint/builds; retain actual captures and limits. | Complete: 924 unit, 69 UI, 22 optimized touch, 30 financial/privacy, 36 intercepted session and final 12 glass cases; types/lint/both builds pass. 455-file source and 68-image raw/control comparisons retain renderer limits. |

The [verification record](GLASS_IMPLEMENTATION_VERIFICATION_2026-10-14.md) and [actual gallery with transition recordings](glass-implementation-2026-10-14/index.html) document the local result, harness repairs, unchanged financial/content source and bounded browser-rendering differences. No deployment, provider operation or further phase is authorized. The G0 entries below retain their historical design-only scope.

## Completed authorized work — G0 Liquid Glass feasibility and concept, 2026-10-14

The owner accepts the implemented mobile UI and requests feasibility review plus a design image for iOS-inspired Liquid Glass on the web topbar/sidebar and mobile dock, with hover magnification on desktop. G0 is research and visual concept only. Preserve the accepted application and all existing mobile changes; generate from actual synthetic desktop/mobile references and record the proposed navigation-only exception to desktop preservation. No application implementation, dependency, deployment, provider or financial/data operation is authorized. Exit criteria are a reviewable concept showing desktop/rest/hover and mobile touch states, an implementation-feasibility note and preserved source evidence.

G0 completes with the [design board and feasibility brief](liquid-glass-concept-2026-10-14/README.md), exact generation prompt, two actual application references and unchanged hashes for all 455 source files. Browser backdrop-filter/transform documentation supports an iOS-inspired web approximation; exact native optics and performance are not claimed. Desktop hover and mobile touch feedback are proposed separately, with unchanged route/active-state/data behavior. The owner has not authorized application implementation of this concept.

The owner accepts the direction and corrects glass coverage: **only the center Dashboard-through-Household capsule**, not the whole desktop topbar. Revision 2 updates both rest/hover examples; logo/bell/profile remain ordinary, sidebar/mobile glass remain. The revised board/prompt and unchanged 455-file source check are retained with the original as history. This is still a concept revision, not application implementation authorization.

## Completed authorized work — M1–M4 local mobile implementation, 2026-10-14

The owner accepts the version 2 mobile concepts and explicitly authorizes implementation, requiring the web design to remain unchanged. The owner excludes Icon Credits and asks for its removal, including the existing local route. Execute these local phases sequentially; no deployment, provider operation, production-data change, financial/domain rule change, new dependency or paid service is authorized. The approved version 2 matching contract governs illustration inaccuracies and omitted continuation controls.

| Phase | Intended outcome and exit criteria | Status |
| --- | --- | --- |
| M1 — Baseline and mobile shell | Preserve current source/configuration snapshots and desktop captures; introduce scoped phone spacing/navigation with unchanged desktop geometry. | Complete: 453-file source manifest, 68 fresh desktop captures, narrow shell checks and types pass; all new style rules are phone-scoped. |
| M2 — Expenses | Compact live Filters sheet, readable mobile rows, form/detail layouts; verify shared query state, mounted drafts, exact splits, privacy, receipts and financial locks. | Complete: live filter/default/resize and mounted percentage-draft browser check passes; 44 focused tests and types pass. Final cross-browser/privacy/receipt/lock acceptance follows in M4. |
| M3 — Remaining pages | Approved mobile Report/Household/Profile/auth/Card/dialog presentation; remove Credits as the explicit exception; preserve existing behavior and authority. | Complete: page/landscape previews, corrected Card-sheet geometry, opened notification/calendar Axe and types/lint pass; all existing chart data and actor/command rules retained. |
| M4 — Acceptance | Compare desktop captures, verify narrow/landscape/reduced-height mobile, opened controls/accessibility, critical financial/privacy journeys, unit/type/lint/build checks; record results and limits. | Complete: 68/68 exact desktop pixels; 924 unit tests, 165 acceptance cases, 72 analytics/notification/mobile cases, 36 intercepted production cases, 25 optimized-runtime phone cases, final Profile/Axe/geometry, lint/types and both builds pass. |

Visual changes are scoped below 640px, with deliberate large-mobile handling only where needed. Desktop 1024px+ and existing tablet layouts remain protected. No global design-token replacement or duplicate financial form trees. Shared accessibility defects may be corrected without changing desktop appearance; exact focused/selected desktop captures remain comparison gates.

The [implementation verification record](MOBILE_IMPLEMENTATION_VERIFICATION_2026-10-14.md) records scope, evidence, repaired failures/replays and physical-device limits. The [actual mobile gallery](mobile-implementation-2026-10-14/index.html) contains 31 page/state captures. All 306 protected business/persistence/API/runtime files, original global stylesheet, dependency manifests and assets remain unchanged. Local implementation is complete; deployment/provider operations remain separately owner-gated. The M0 entries below retain their historical authorization/status wording.

## Completed phase — M0 mobile inspection and design, 2026-10-13

### M0 revision complete — same web identity, app-like mobile layout, 2026-10-14

The owner rejects the first concepts' visual drift and clarifies that mobile must follow the existing web design while feeling like an app. The currently authorized continuation is design-only revision using actual desktop captures as references: retain exact visual tokens, grouped/inset panel treatment, black selected pills, icon assets and typography; adapt layout, density and mobile access patterns. Publish versioned replacement concepts and a clarified design contract. No application implementation or desktop change is authorized by this clarification.

The [version 2 gallery](mobile-design-2026-10-13/index.html) now presents six revised boards using actual existing screenshots as visual references; 14 desktop captures are bundled for comparison. [The design contract](mobile-design-2026-10-13/DESIGN_IDENTITY_V2.md) records the preserved identity, mobile adaptations and remaining illustration limits. The first set is explicitly superseded as design direction and retained in the historical gallery. Application/source/provider/dependency/desktop state remains unchanged. Version 2 is proposed for review; M1–M4 are still not authorized.

The owner reports that the released desktop UI is praised but mobile UX is poor, and requests a full mobile inspection plus page UI images while protecting desktop. M0 is local inspection and design only: inspect existing routes, mobile navigation, forms, dialogs and access states using disposable synthetic fixtures; measure narrow-screen geometry and accessibility; retain screenshots and generate proposed mobile page images; document evidence, limitations and any proposed frozen-design changes. Exit criteria are a reviewable audit, page/state coverage and mobile concepts with a desktop-preservation contract. No application implementation, deployment, provider operation, production-data change or new dependency is authorized. A later implementation phase requires acceptance of the proposed scope; this request does not amend frozen design behavior implicitly.

M0 completes with [the mobile audit](MOBILE_UI_UX_INSPECTION_2026-10-13.md) and [visual review gallery](mobile-design-2026-10-13/index.html): 146 measured page/state/viewport captures, 292 raw screenshots, six generated boards/27 illustrative compositions and retained prompts. The final core inspection run passes four tests with two intentionally Chromium-only overlay skips; the supplemental state run passes one test. No page overflow is measured. State-level Axe records existing notification-menu semantics failures and enabled adjacent-month Date-picker contrast failure; these are reportable findings, not fixed by this phase. The audit records harness repairs/replays, source-only and real-device limits, image inaccuracies that must not become product changes, and scoped M1–M4 recommendations. M1–M4 are not authorized by this plan. All application, provider, desktop and production state is unchanged.

## Completed phase — R0–R2 production UI release, 2026-10-13

The owner explicitly authorizes the 24-hour session policy and production deployment of the accepted UI/maintenance/optimization, strictly preserving all user data. R0 records approval, checks the complete candidate and runs hosted CI on a separate release branch. R1 merges/deploys only after the release gates pass. R2 checks anonymous live behavior and read-only preservation evidence, retains rollback, and records the result. Execute these phases sequentially; no reset, provisioning, migration, schema/permission change, maintenance-worker update, authenticated QA mutation or paid service is authorized.

The owner reports saving Appwrite Session length as 24 hours / 86,400 seconds. Both computer-control tools fail to initialize on this host, so this is owner-confirmed configuration rather than an independently inspected Console value. Existing cookie/provider-expiry and focus/visible-tab/online checks need no implementation change. No new exact-expiry browser timer is introduced.

Release evidence is maintained in [PRODUCTION_UI_RELEASE_2026-10-13.md](PRODUCTION_UI_RELEASE_2026-10-13.md). R0 passes on candidate `130db02`: both hosted workflows and Appwrite preview succeed. R1 merges PR #2 as `fe346ec` and confirms Appwrite production build success plus changed live UI content. R2 passes 36/36 fixture-only live cases without retries, anonymous reads and exact before/after digests for all 16 tables and 12 files. Maintenance configuration is unchanged. Merged-main CI passes every job, including 132/132 critical journeys. No production user-data write was made.

Final bookkeeping publishes the accurate release state and a test-only wait for completed bootstrap before simulated mutations. This retains the API fixture barrier and every mutation/session assertion, changes no application/runtime/dependency/configuration/asset file, and requires no migration. No subsequent implementation, provider operation, paid service or production-data change is authorized.

## Completed phase — O0–O3 local optimization and cleanup, 2026-10-12

The owner accepted the design and requested full local optimization followed by cleanup, preserving every feature and existing production users/data before a later owner-managed deployment. The sequential phases below are complete. [OPTIMIZATION_VERIFICATION_2026-10-12.md](OPTIMIZATION_VERIFICATION_2026-10-12.md) is the fresh verification record; [PROJECT_STATE.md](../PROJECT_STATE.md) is the current status summary.

That earlier authorization included local refactoring, proven-unused cleanup, compatible dependency security updates and verification repairs. Deployment was outside that phase; the 2026-10-13 owner instruction separately authorizes the narrow release phases above.

| Phase | Outcome and exit evidence |
| --- | --- |
| O0 — Baseline and audit | Existing uncommitted work copied outside the checkout, source/configuration SHA-256 manifest recorded, 924 baseline tests passed, Appwrite baseline build and six representative responsive journeys passed. Import, CSS and package audits scoped the changes. |
| O1 — Shared presentation | Payment rows, Receipt placeholders, filter shells and chart prop types consolidated; overridden CSS/utilities and 17 unused UI exports removed. Three exact Radix state variants retain popup behavior. Focused checks and before/after screenshots passed. |
| O2 — Cleanup | Obsolete Brand/MemberRow/PNG icon removed; shadcn moved to development dependencies. Operational entry points, backups/restores, financial suites and evidence retained. Sharp 0.35.5 and compatible transitive patches resolve the registry advisories; no unrelated dependency version changes. |
| O3 — Final verification | Clean installation, 924 tests, both optimized compositions, zero-warning lint, TypeScript, audits and whitespace passed. Core/privacy/financial, intercepted session, additional analytics/notification/profile/persistence and responsive/accessibility cases passed with documented replays and one existing Windows-only Receipt skip. |

O3 uncovered existing mobile chart date overlap and vertical clipping. Reclaiming 8px of internal padding per side below 480px and allowing the Dashboard chart card to grow from its existing minimum below 640px makes the complete labels visible without smaller fonts or changed data. The SVG geometry regression now measures actual glyph bounds and checks overlap, clipping, alignment and scrolling; nine final geometry/Dashboard/Report cases pass in all three engines.

All 341 protected business/persistence/API/runtime/configuration/operational files remain byte-identical to the optimization baseline. Schema V9, exact poisha, immutable history, private metadata, receipt/avatar authority, session recovery and command contracts are unchanged. Only the listed dependency patches and presentation/test/documentation changes are introduced.

The source baseline, package deltas, screenshots, metrics and traces are saved outside the checkout under `C:/Users/raiya/.codex/visualizations/2026/10/12/01a12fe3-ed2f-7aa1-b3ce-8934266bc625/optimization/`. The app remains available locally at `http://localhost:3000`. Deployment is a separate owner action; this code update requires no schema, data, permission or maintenance-worker migration.

## Explicit remaining limits

- Linux-hosted candidate/main CI passes the release. Disposable persistent WebKit test profiles now enable native receipt persistence on every platform; the old Windows skip was removed.
- The existing 5,000-row provider-read overflow finding remains unchanged and separately approval-gated; see [the benchmark report](HISTORY_READ_BENCHMARK_2026-10-11.md). No live user/data volume was inspected.
- Build-size measurements are summed emitted assets; they do not establish production latency. The release uses successful provider builds, changed public content and read-only preservation evidence; no authenticated financial mutation or real 24-hour session test was performed.

## Historical plans

The detailed preceding maintenance, U1–U9 and O0–O3 checkpoints are preserved verbatim in [ACTIVE_PLAN_HISTORY_2026-10-12.md](ACTIVE_PLAN_HISTORY_2026-10-12.md). Older checkpoints remain in [ACTIVE_PLAN_HISTORY_2026-10-11.md](ACTIVE_PLAN_HISTORY_2026-10-11.md). Archives preserve evidence and never authorize new work.
