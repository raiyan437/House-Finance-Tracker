# U4 Household decoration, footer and fixed sidebar — local verification

Owner-authorized scope on 2026-10-12: remove the decorative member icons above the House Leader section, remove the Credits link at the bottom of every page, and keep the desktop sidebar fixed during scrolling.

## Implementation

- Removed the Household decorative avatar row and its 44px reserved top spacing. The House Leader identity/avatar and active Members list remain unchanged.
- Removed the shared root-layout footer and unused footer styles. The existing `/credits` attribution page remains available directly; its browser check now visits that URL.
- Changed the 72px desktop rail from sticky to fixed positioning, retaining its 88px top offset, screen-centered menu, existing short-viewport internal scrolling and development controls. Explicitly placed product content in the second desktop grid column so the fixed rail does not overlap it. Mobile navigation is unchanged.

All implementation edits are presentation-only. No financial/domain/application/persistence/API/provider/permission logic or dependencies were edited. Existing uncommitted maintenance and redesign work is preserved. React review found no added hooks, effects, fetching, state ownership changes or client/server boundary changes.

## Verification

- Existing Navigation, Household UI and fallback component suites: 27/27 pass across three files.
- TypeScript passes; targeted ESLint passes with zero warnings; Git whitespace check passes.
- Twelve distinct browser cases are covered successfully across Chromium, Firefox and WebKit: existing desktop/menu/header alignment, scrollbar/dialog scroll locking, 404/direct attribution page, and the new U4 scroll/layout regression.
- The U4 regression checks Household, Dashboard, Expenses, Settlements, Cards, Profile, Notifications and Monthly Report at 1024x600, 1440x900 and 1920x1000 in each engine. Short routes receive temporary test-only minimum height so every route exercises actual document scrolling. At top, middle and the actual document bottom, the rail and menu retain identical viewport rectangles, Logout remains reachable, and horizontal overflow is absent. No application data is changed by this height adjustment.
- The existing alignment check also covers 1280x900 and confirms short-viewport controls remain reachable at 1440x480. The new mobile Household check at 390x844 confirms the rail is hidden, mobile navigation and leader identity remain, decorative avatars/footer are absent, content is centered, and there are no serious/critical Axe findings. The existing 404/attribution checks also include mobile/desktop Axe coverage.
- Initial aggregate: 11 browser passes and one WebKit test failure. A standalone WebKit scroll probe confirmed `Number.MAX_SAFE_INTEGER` scrolls to zero rather than the bottom. The test now calculates the real document bottom and asserts the exact reached position. Final corrected U4 run: 3/3 pass across all engines; the other nine cases passed in the initial run.
- Desktop/mobile Household screenshots were visually reviewed. Artifacts are retained outside Git under `C:/Users/raiya/.codex/visualizations/2026/10/12/01a12fe3-ed2f-7aa1-b3ce-8934266bc625/u4-verification/`.

Verification used isolated synthetic browser fixtures against the running local IndexedDB development app. Full financial suites and optimized builds were not rerun for these focused presentation edits. No commit, push, deployment, provider operation or new implementation phase was performed. The local app remains at `http://localhost:3000` for owner review.
