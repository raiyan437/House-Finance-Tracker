# U1 local navigation and Dashboard refinement — 2026-10-12

The owner authorized five presentation refinements: permanently compact sidebar, consistently centered pages, notifications beside the header Profile control, corrected Dashboard spacing/avatar placement, and animated navigation selection. This supersedes expandable-sidebar and Dashboard-only notification-bell placement. Production deployment remains outside scope.

## Result and preserved behavior

The desktop shell uses a fixed 72px icon rail without an expansion control. Accessible navigation names, badges, current identity/role description and hover title, Profile, development controls and the existing Logout action remain available. Constrained pages use automatic inline margins and symmetric padding from mobile through wide desktop; the shell height accounts for the header.

One shared notification dropdown sits immediately before Profile with an 8px gap. Its existing recipient-filtered reads and commands are unchanged. The component resets on viewer or Household access-context changes; session refresh and menu interaction do not remount form drafts.

Dashboard summary panels use a uniform 16px grid gap, compact member rows with right-aligned amounts where space permits, and scrollable keyboard-accessible balances for longer member lists. The avatar tray is centered, has separate evenly spaced avatars and overflow count, and sits below the heading on mobile. Recent Expenses retains its exact existing link in the heading area with clearance for the mobile collapse control. Static centering survives reduced motion. The development launcher is disabled because it covered the mobile More button; Next.js compile/runtime error reporting remains enabled.

Header and sidebar have a decorative moving selection outline (240ms). Native links navigate immediately; active text remains readable and keyboard focus is not reassigned by the animation. Reduced motion disables the decorative animation; unchanged ResizeObserver notifications cannot cancel it. The arriving route keeps the existing 200ms optional motion and mounted draft contract.

Verification follows navigation/menu interaction → unchanged runtime actions → IndexedDB or intercepted same-origin API → unchanged projections → updated shell. No domain, application, persistence, API, runtime implementation, dependency or financial arithmetic change was made. All existing uncommitted maintenance remains preserved.

## Evidence

| Check | U1 result |
| --- | --- |
| Focused runtime/session, navigation and analytics components | 36/36 pass |
| Final responsive screenshots and Household authority/onboarding | 35/35 Chromium pass |
| Notification adjacency, recipient isolation, keyboard and six viewport checks | 9/9 Chromium pass |
| Native IndexedDB identity/reopen and compact responsive shell | 10/10 Chromium pass |
| Critical financial/privacy/navigation flows | 53 pass across Chromium/Firefox/WebKit; one existing Windows WebKit Receipt-storage skip |
| Intercepted production-session recovery and Profile drafts | All 30 checks covered across three browsers: 29 pass in the parallel run; the remaining Firefox check passes a traced serial rerun |
| Zero-warning lint and TypeScript | Pass |
| Optimized builds | Local and Appwrite compositions pass on this computer; no deployment |
| Restored local development server | Dashboard HTTP 200; compact laptop shell and local DEV controls verified in Chromium |
| Final whitespace | Pass |
| Protected baseline comparison | 302/303 files unchanged; the sole difference is a unit-test fixture; no added protected files |

The production-runtime unit fixture now mocks the relocated bell so unrelated notification reads do not masquerade as the commands/session requests being counted. Its command, lost-response, recovery, 401/403 and draft assertions remain intact; the real dropdown is exercised in browser coverage. The initial stale fixture caused five component failures; the corrected focused run passes all 36 cases.

One intercepted Firefox successful-save/failed-refresh check timed out waiting for the success message in the parallel run. The unchanged check passes when rerun serially with tracing; no production/runtime behavior or assertion was weakened. Its intermittent cause was not established. Other recovery, duplicate-write prevention, notification reads, Profile drafts and 401/403 checks pass in the original run. Production API fixtures include the shared bell's empty latest-notifications response; the production Profile visual check blocks every unmatched API request.

Full-suite attempts stalled before completion on this Windows host and were stopped; no fresh full-suite result is claimed. The earlier 919/919 R7 result remains historical evidence in [the original report](UI_REDESIGN_VERIFICATION_2026-10-12.md), not a fresh U1 claim. Focused components and critical browser flows provide the U1 regression evidence. The existing Windows WebKit IndexedDB Receipt Blob limitation remains separately recorded.

Screenshots and scope evidence are in [the U1 artifact directory](C:/Users/raiya/.codex/visualizations/2026/10/11/01a12bc8-e6c4-7172-a897-a5ef171b9cea/ui-redesign-verification/u1), with `u1-protected-before.json` and `u1-scope-proof.json` in its parent directory. Screenshots use isolated synthetic fixtures, never the owner's local data. Final visual review includes desktop/mobile Dashboard and the centered Profile/Cards/Household layouts; geometry and serious/critical Axe assertions cover 360/390/768/1024/1440/1920px.

The local IndexedDB development server is running at `http://localhost:3000` for owner visual review. No commit, push, deployment, schema/provider/account operation or new paid service was performed. Production activation still requires separate owner authorization.
