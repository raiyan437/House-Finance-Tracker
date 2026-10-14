# Mobile implementation verification — 2026-10-14

## Outcome and authority

**M1–M4 are complete locally.** The owner approved the version 2 mobile concepts with the same web identity, an app-like phone layout, unchanged desktop design, and removal of Icon Credits. Implementation remains local: no deployment, push, provider configuration, production account/data operation, migration, new dependency or paid service.

The [actual mobile gallery](mobile-implementation-2026-10-14/index.html) contains 31 implemented page/state screenshots, including production-only Profile/recovery fixtures. [Desktop pixel results](mobile-implementation-2026-10-14/desktop-comparison.json), [protected-source results](mobile-implementation-2026-10-14/protected-source.json) and [verification summary](mobile-implementation-2026-10-14/verification-summary.json) retain compact evidence in the repository.

The [accepted matching contract](mobile-design-2026-10-13/DESIGN_IDENTITY_V2.md) governs illustration omissions and inaccuracies. Existing category assets/order, five navigation destinations, chart data, financial permissions, receipts, privacy copy, activity, comments and continuation content are retained. The generated Credits screen is excluded as explicitly requested; source icon attribution/author metadata remains intact.

## Implemented scope

- A separate phone stylesheet applies below 640px, retaining the web tokens, Inter, inset/grouped surfaces, black pill actions, existing avatars/icons and chart colors. It compacts the header, Dashboard panels/member rows, Expense rows/form/details, Report, Household, Profile and standalone auth/fallback layouts. Tablet styling and the original global stylesheet are unchanged.
- The dock retains Dashboard, Expenses, Add, Settlements and More, their active-route rules, action counts, accessible names and safe-area treatment. Long Card forms become scrollable phone sheets; confirmations remain explicit.
- Search and Month stay visible on Expenses. The phone Filters sheet exposes the existing live Month/Paid By/Payment Method/Sort/Clear controls; no new filter, Apply step or changed reset default. Its query stays in the original parent; open-state presentation alone unmounts at the desktop breakpoint.
- Financial forms remain mounted when navigation overlays open or viewports change. Split methods, allocations, receipt authority, save/lock behavior and command handlers are unchanged.
- Phone chart labels are less dense and larger, while every calendar day and zero day remains in the data/bar domain. Smaller rings retain the same values and colors. Desktop chart parameters are unchanged.
- Shared notification-menu accessibility now registers Mark all as a menu item and makes the background shell inert while the portaled menu is open, restoring its prior state on close/unmount. Existing menu appearance, mutations and unread behavior remain. Enabled adjacent-month Date cells get readable phone contrast; allowed-date rules are untouched.

## Desktop and protected-source evidence

Entry source: `0ae12b1b719d7ec8639ee668f0f1f1a93ea4bec3`. A fresh 453-file SHA-256 manifest and complete original source copy were recorded before implementation.

**68/68 desktop screenshots match decoded pixels exactly**, with identical dimensions and zero changed pixels. Coverage: 16 routes at 1024/1280/1440/1920 × 900, plus Add Card and receiver-confirmation dialogs at 1024 and 1440. This covers these settled states, not every possible desktop hover/focus/provider variant. Credits removal is the owner-approved exception.

All **306 protected domain/application/infrastructure/architecture/API/runtime source files** remain byte-identical. Of 453 original source files, 442 are unchanged; 10 presentation/UI/layout files changed and Credits was deleted. Three new presentation/style files were added. `globals.css`, `package.json`, `package-lock.json`, existing assets and operational/runtime configuration are unchanged. Playwright configuration changes only add the new mobile regression file to browser coverage.

## Verification

| Gate | Result |
| --- | --- |
| Full Vitest suite | 924 tests / 117 files pass with two workers. |
| Focused expense/shell/chart unit checks | 44 tests / 6 files pass. |
| Mobile, analytics and notifications | 72 browser cases pass across Chromium, Firefox and WebKit, no retries. |
| Critical financial/privacy and responsive page/control matrix | 165/165 pass across Chromium, Firefox and WebKit, no retries: 14 responsive route matrices, Household access variants, Card dialogs, seven Expense-control widths and critical actor/money/history/privacy journeys. |
| Production composition with intercepted API fixtures | 36/36 pass across all three engines, no retries; phone viewport by default, with responsive Profile/fallback matrices. After final phone typography, 3/3 production Profile photo/password cases pass again. |
| Optimized local runtime phone regression | 25/25 pass across the three engines plus touch-enabled Android/Chromium and mobile/WebKit profiles, including settled 390 × 430 Card resizing and retained draft/reachable Cancel. |
| Touch browser profiles | 10/10 phone cases pass in the development runtime; these are emulated profiles, not physical devices. |
| Final mobile gallery/geometry | 48 route/viewport captures at 320/390/430 × 844 plus 12 opened/draft/access states; zero page errors and no positive horizontal overflow. Final captures use the touch-enabled Chromium profile. Gallery links, 31 image targets and fit at 390/1440 pass. |
| Opened-state accessibility | Notification menu, Card sheet and enabled calendar states have zero serious/critical Axe findings in the tested mobile cases. The responsive page/access/dialog matrices and final local/production Profile checks pass their serious/critical Axe gates. |
| Lint, TypeScript | Pass. Route types were regenerated after Credits removal. |
| Optimized builds | Both local and Appwrite compositions pass. |
| Whitespace | `git diff --check` passes. |

At 390px, the first Expense row begins at **y=362**, compared with the pre-change list heading at y=782. Dashboard document height falls from 2624px to 2042px; Add Expense from 2543px to 2102px; Edit from 2770px to 2349px; Details from 2253px to 1803px. Final measurements use a touch-enabled browser profile; the initial audit used desktop-engine phone viewports, so small wrapping differences also reflect scrollbar treatment. These are synthetic fixture measurements, not real-user task-completion metrics. All existing content remains available through scrolling.

## Complete flow and practical limits

The story is phone navigation/filtering → existing runtime actions → authoritative local or trusted production command boundaries → refreshed exact financial/permission views.

| Boundary | Evidence |
| --- | --- |
| UI → query/render | Live payer/payment filters, original Clear defaults, query retention across desktop resize, mounted percentage draft and exact ৳99.99 share are checked through browser interactions. |
| UI → local command/data | Expense/receipt persistence, private Cards, Household authority, Pending/Confirmed/Reject/Cancel actor rules, exact balances and stale financial locks are covered by the final acceptance matrix. |
| UI → production transport | Intercepted fixtures exercise bootstrap, Profile commands, expiry, permission denial, outage, uncertain responses, explicit idempotent retry, password/photo visibility and retained drafts. Unmatched API requests are blocked. |
| Trusted handler → provider/data | Existing handlers, domain and adapter files are unchanged and covered by the unit/architecture suite. No fresh authenticated provider operation or live financial mutation is claimed. |
| Response → UI | Synthetic persistence/reopen checks and intercepted successful/expired/forbidden/unavailable responses verify rendering, feedback and recovery. |

React review confirms module-level components, controlled shared query, consistent hooks, a server-safe external-store snapshot and cleanup, no additional data-fetch path or provider dependency, and one financial form tree. Original command schemas, transport, BigInt/poisha arithmetic, quotas, idempotency and authoritative actor/date contracts remain unchanged.

Physical-device keyboard resizing/input zoom, hardware safe-area cutouts, OS gestures, screen readers, poor-network usability and real user interviews were not tested. Reduced viewport height is a layout proxy for a keyboard. Automated Axe findings and exact screenshot coverage are bounded evidence, not a blanket WCAG or every-state certification.

## Repairs and retained evidence

- The initial Card-sheet preview exposed inherited centered-dialog translation. Phone overrides now clear both individual translate variables and transform; actual rectangle checks were added.
- A desktop Add Expense capture initially missed lazy images. Waiting for image decode restored parity. A remaining 43-pixel month-glyph difference was traced to split text nodes; restoring the original single-string label yielded 68 exact matches.
- One full unit run timed out on a 5-second synchronous architecture source scan under concurrent load (923 passed); the complete unchanged suite then passed with two workers and the original assertions/timeouts.
- One Firefox dropdown/navigation case timed out while other checks/source work overlapped; its unchanged isolated replay passed. A later acceptance attempt stopped on a stale single-row metadata assertion. The test now measures status-before-date order by row centers and supports the intended wrap; seven Chromium width cases pass. A subsequent attempt encountered an exited dev server before fixtures initialized; it was restored in local mode and the final stable run uses the unchanged application candidate.
- The short-height Card capture initially scrolled before dynamic viewport height had settled. Waiting for the actual dialog height before scrolling verified reachable Cancel without an application change.
- Final phone Profile polish reduces metadata text slightly and stacks its inset value boxes below 360px so the sample email is readable without a lone trailing letter. Three final local and three production Profile matrices pass; desktop pixels remain exact. A desktop replay exposed two simultaneous loading placeholders; the capture harness now waits for the complete loading-state collection to disappear. Final capture replay passes with zero page errors and 68 exact matches.

Full source snapshots, manifests, raw captures, decoded-pixel report, test configurations, logs/results and failure traces are retained outside the checkout under `C:/Users/raiya/.codex/visualizations/2026/10/13/01a13607-5fba-7aa3-850c-43766afdcee2/mobile-implementation-2026-10-14/`. All records are disposable synthetic fixtures. The local app is available at `http://localhost:3000`; production remains unchanged.
