# Deployment readiness — 2026-10-14

The owner requests fixing release gaps and preparing the accepted mobile/glass/F changes for deployment. Preparation covers D0–D2; production activation remains unexecuted. The reverted color treatment stays absent.

## Candidate and protection

- Base: refreshed remote `main`, `0ae12b1b719d7ec8639ee668f0f1f1a93ea4bec3`, independently confirmed through Git and the GitHub connector. Appwrite's commit status reports success on that base.
- Release branch: `codex/mobile-glass-ui-release`. All accepted local work is preserved; required untracked source and test files are included in the candidate scope.
- Current active Ready rollback deployment: `6ace4d2ce216ab03e861`, owner-confirmed in chat. The current API credential receives 401 for Site/Auth-account reads, and browser tooling fails kernel initialization. No credential scope was widened; deployment ID/source mapping is not independently observed.
- Read-only baseline captured for available production table/file metadata and maintenance configuration, with GET-only SDK guards. Private values and credential files remain outside Git. Production records/settings are unchanged.
- Domain/application/infrastructure/API, package/lock/Next configuration and the production session/write logic remain protected. Credits removal and the existing approved glass scope remain; the color stylesheet/annotations are absent.

## Fixes made in preparation

1. CI's critical-journey command now includes `mobile-layout.spec.ts` and `glass-navigation.spec.ts`.
2. All seven existing responsive Expense-control cases carry `@critical`, retaining their original assertions and the phone date/comment geometry check. Firefox/WebKit now select them.
3. The production-session suite adds a deterministic, tagged-BigInt Expense read fixture to check actual date layout at 320/390/430/768/1440px. It runs in the Appwrite composition and uses the existing unmatched-API abort barrier; no real production write or local database seed operation occurs. The synthetic seed factory supplies only in-memory fixture data.
4. The rapid-navigation/Back test now waits for the ready local runtime/fonts and visible displacement away from Cards before Back, then checks the committed selected link. It retains the four-transition requirement, persistent lens, settled geometry and accessibility assertions. Immediate Back can return before visible departure and legitimately require no additional movement; separate deterministic interrupted-motion assertions remain unchanged. No application animation is changed during preparation.
5. The Cards/Profile six-width visual check receives the existing peer-test 90-second budget for twelve route visits and four screenshot/Axe passes. Its individual 15-second assertion limit and all layout/accessibility assertions remain unchanged.

## Verification history and evidence hygiene

The first integrated run passed 154 cases, then stopped at WebKit's rapid-navigation/Back animation-count assertion (three recorded transitions versus four). One following case was interrupted and 29 were not run. Its trace records Household as selected with an animation running immediately before Back, then Cards aligned without movement; the count alone does not identify the missed transition. An instrumented replay passed with visible Household travel before Back. The strengthened visible-departure precondition removes that timing ambiguity; subsequent combined-run and replay results are recorded below. Original failure and diagnostic logs/traces remain outside Git rather than being hidden by retries.

The next integrated run passes 177 cases, including all glass/mobile suites and the previously failing WebKit Back check. It stops when the Cards/Profile multi-viewport test exhausts its default 30-second total budget: the trace shows five complete widths and the sixth viewport change at 29.6 seconds, with no preceding layout/Axe assertion failure. One case is interrupted and six not run. After the narrowly scoped budget correction, the complete UI redesign suite is replayed across all three engines to verify the affected check and finish all unrun acceptance cases. Both interrupted runs remain recorded; final coverage is determined from the passing case union rather than claiming either run passed uninterrupted.

Staged gallery links resolve and no environment, generated build, raw test output or credential file is included. Whitespace-only normalization of three older design documents fixes the PR whitespace gate; original copies remain outside Git, and the affected gallery index's manifest is refreshed. Historical rejected color evidence stays labelled as superseded; its implementation is absent from the candidate.

## Gates

| Gate | Status |
| --- | --- |
| Clean locked install | Pass; no lock/package changes. npm 11 reports pending postinstall approval for two existing packages; no blanket script approval or config change was made. Unit/static verification works with the installed optional binaries. |
| Full unit/integration/architecture | 925 tests / 117 files pass. |
| Dependency audit | Zero vulnerabilities; strict audit passes. |
| Final TypeScript/lint | Pass; verification logs retained. |
| Critical selection matrix | 185 cases: Chromium 91, Firefox 47, WebKit 47. Every engine selects 8 glass, 5 mobile-layout and 7 date/control cases. |
| Integrated local browser acceptance | Pass for all 185 unique cases: 177 passing combined-run cases plus the complete affected 53-case UI replay. Final counts: Chromium 91, Firefox 47, WebKit 47; no automatic retries or remaining failures. Original failures retained below. |
| Local/Appwrite builds | Pass; both optimized compositions build successfully with servers stopped. |
| Appwrite session fixtures | 48/48 pass, no retries (16 per engine). New date geometry, accessible loader, mounted drafts, delayed navigation, outage/recovery, expiry and write safeguards all pass. |
| Exact-head PR/hosted CI/preview | D2 handoff: publish only the release branch/draft PR. Record exact-head hosted results and preview/access status on that PR; matching Ready preview review remains a production activation gate. |

Existing reports retain accepted implementation images, functional/financial/privacy evidence and physical-device/raster limits. Preparation changes CI and test selection/fixtures, not product behavior. A fresh release run is necessary because earlier phases were verified independently.

Detailed logs, source manifests, matrix JSON, API baseline and rollback-reference provenance are retained outside Git under `C:/Users/raiya/.codex/visualizations/2026/10/13/01a13607-5fba-7aa3-850c-43766afdcee2/deployment-readiness-2026-10-14/`. All 457 application source files remain identical to the accepted pre-readiness snapshot; this preparation changes only CI/tests/docs. The matching [phone capture](deployment-readiness-2026-10-14/production-expense-date-390.png) and [desktop capture](deployment-readiness-2026-10-14/production-expense-date-1440.png) use synthetic intercepted reads in the optimized Appwrite composition. No real financial record is shown or written.

D1 local gates are complete. D2 external evidence is tracked on the release PR so its final head can be tested without recursively changing the candidate merely to record hosted statuses. Production merge/activation remains unexecuted; rollback reference `6ace4d2ce216ab03e861` is owner-confirmed, and the current Site/API/browser access limits remain explicit. Physical-phone FPS and authenticated hosted-preview acceptance are not inferred from emulation or local fixtures.
