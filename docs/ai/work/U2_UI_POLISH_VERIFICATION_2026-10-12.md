# U2 local shell, fallback and page-motion refinement — 2026-10-12

The owner authorized seven presentation refinements. The duplicate Home link above Dashboard and the decorative blue selection marker are removed. Existing active black pills remain; keyboard-only focus is neutral and visible. Cards use compact tiles bounded at 344px, with one/two/three/four columns as available width increases. Profile no longer contains Icon Credits; the unchanged twelve asset source/author links live at `/credits`, reached through a quiet shared footer.

The root 404, root error, fatal document error and root loading screens now use the approved pearl canvas and rounded inset panel. Product loading/error and shared feature states receive consistent styling. Production startup/unavailable render helpers use the same frame. Existing retry/reset callbacks, anonymous redirects, connection guards, transport behavior and financial commands are retained; raw error details are not rendered. The fatal fallback supplies its own document and imports the shared CSS, as required by the installed Next.js version.

The document reserves a stable scrollbar gutter and keeps vertical scrolling enabled on long and short pages. Under browsers supporting stable gutters, only Radix's redundant body margin compensation is removed; its wheel/focus/dialog scroll-lock behavior is retained. Native document scrolling is instant, avoiding Firefox click-target movement during automatic scrolling; separate page-entry motion provides the transition. Browser checks compare header/gutter/panel coordinates across navigation, opening/closing a dialog, and attempted background wheel scrolling.

The persistent arriving page opens with a 320ms, 14px lift and slight scale, waiting for its loading skeleton to resolve. It stays fully opaque and does not remount forms, change values, delay commands, or retain a private exit snapshot. Pointer/focus interaction immediately cancels the decorative motion. Auth/standalone panels use matching CSS entry motion. Reduced motion disables this movement; listeners/observers are cleaned up on navigation and media changes. Existing button press feedback remains.

## Local verification

| Check | Result |
| --- | --- |
| Navigation, Cards, Profile and production-runtime components | 40/40 pass |
| Fallback retry/privacy and architecture boundaries | 34/34 pass |
| Final Chromium visual/responsive/Card journeys | 27/27 pass |
| Compact desktop/mobile shell and More sheet | Nine existing checks pass in the initial browser run |
| Cross-engine critical journeys | All 62 non-skipped cases covered across runs: 60 initial passes plus two corrected Firefox replay passes; one existing Windows WebKit Receipt-storage skip |
| Entry interruption/geometry/404/Cards/reduced-motion replay | 22 local cases pass across three engines; the two remaining Firefox clicks pass after instant native scrolling is restored |
| Intercepted production session/failure recovery | 36/36 pass serially across Chromium/Firefox/WebKit, including unavailable/exception Retry and sanitized fallback screenshots |
| Zero-warning lint and TypeScript | Pass |
| Local/Appwrite optimized builds | Both pass locally; no deployment |
| Restored local development server | Compact Cards/Profile and stable navigation/dialog scrollbar checks pass in Chromium |
| Final whitespace | Pass |

Responsive geometry covers 320/390/768/1024/1440/1920 CSS pixels for compact Cards/Profile and 360px onward for the complete visual suite. Existing serious/critical Axe checks cover the feature/auth routes; new checks cover the 404, Credits and scroll-lock refinements. Screenshots disable finite animations only during capture, so images show the final layout; separate checks record the real 320ms page animation and verify reduced motion and draft retention.

The first browser run exposed overly broad selectors: `Edit` also matched the new `Credits` footer, `header` included chart headers, and `Display Name` matched both a section and input. Selectors now identify the intended control precisely; functional/history/permission assertions are retained. After correction, the Card history check and all 27 affected Chromium visual/Card checks pass. The retained debug artifact documents the selector failure.

Two Firefox Household clicks initially missed their expected result in both parallel and traced serial runs. Pointer/focus interruption is now explicit; tracing additionally exposed scrolling during the click sequence. Changing native scrolling from smooth to instant resolved both original checks in a traced serial replay without changing any financial/authority action or weakening an assertion. The page-entry motion remains. A broad replay invocation also accidentally selected two production-only fallback checks against the local composition; those environment-mismatched failures are excluded from local evidence. Both pass in the subsequent correctly composed 36/36 intercepted Appwrite run.

## Scope evidence and limits

The U2 baseline includes 303 protected files. 302 are byte-identical; the only changed protected file is the production runtime module's two render helpers and presentation import. AST comparison confirms `AnonymousRedirect`, `buildReadyState` and `ProductionApplicationRuntime` declarations are unchanged, including their contained commands/session handlers. The baseline matches HEAD for that module before U2. Domain, application, persistence, API, dependency and all other protected files are unchanged. No schema migration, provider/account mutation or new paid service was performed.

Evidence lives in [the U2 artifact folder](C:/Users/raiya/.codex/visualizations/2026/10/11/01a12bc8-e6c4-7172-a897-a5ef171b9cea/ui-redesign-verification/u2), with `u2-protected-before.json` and `u2-scope-proof.json` in its parent. Images and browser mutations use isolated synthetic fixtures. Root/product reset callbacks are covered by component tests; product exception recovery is additionally exercised with intercepted invalid/readable Card responses. The fatal document's structure/privacy and optimized compilation are checked without forcing a real root-layout failure. Historical whole-suite/performance/browser-zoom limitations remain in the R7/U1 reports; no fresh whole-unit-suite or comparative timing claim is made for U2.

The restored local IndexedDB development app runs at `http://localhost:3000` for owner visual review. All work remains local and uncommitted. No push or production deployment is authorized or performed.
