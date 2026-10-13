# U3 shell alignment — local verification, 2026-10-12

The owner's five refinements are implemented locally. The six desktop rail controls form one vertically screen-centered stack; Profile is available in the header only, and Logout follows Household with the same 12px spacing. The wordmark starts at the rail buttons' left edge, with its House icon centered on their axis. Equal header side columns keep navigation centered independently of branding and account controls. A scrollable rail keeps controls reachable below 500px viewport height. Mobile navigation and existing motion remain intact.

## Preserved behavior

Routes, native links, active states, badge calculations, notification commands/isolation, avatar capability checks and Logout capability guard/action are unchanged. Identity/role remain available in the header Profile control's accessible description and hover title. Existing role/identity tests now select that control; financial/access assertions remain intact.

All 302 protected implementation/dependency files match the U3 starting working tree. The sole changed file among the 303 captured paths is the production-runtime unit test, whose identity assertion now checks the header Profile description. No protected files were added. Domain/application/persistence/API/provider implementation, exact poisha arithmetic and permissions are unchanged. Earlier uncommitted maintenance/redesign work is preserved.

## Verification

- Navigation and production-runtime unit suites: 27/27 pass, including wired sign-out, unavailable sign-out, badges, session recovery and capability/access gates.
- Chromium browser coverage: 36 distinct cases covered successfully across responsive shell, notifications, native IndexedDB identity reopen, Household onboarding and management. Initial run passed 29; seven measurement failures passed after correcting test synchronization/assertions. One mobile touch-target test measured the existing page-entry scale before completion; it now awaits animation completion. Six notification overflow assertions incorrectly required zero when a reserved scrollbar gutter produced -15; they still reject any positive overflow.
- Two final geometry/screenshot checks pass. Desktop measurements at 1024x600, 1280x900, 1440x900 and 1920x1000 prove menu and header centers, branding/icon alignment, 12px Household/Logout gap and non-overlapping header/development controls. The 1440x480 rail keeps Logout/development tools reachable. Mobile header controls fit at 320/390/768px; existing mobile More keyboard, focus, touch-target and Axe checks pass. No serious/critical Axe findings in the exercised responsive views.
- Local-composition optimized build, TypeScript, zero-warning lint and Git whitespace check pass.
- Desktop/mobile screenshots were inspected under `C:/Users/raiya/.codex/visualizations/2026/10/11/01a12bc8-e6c4-7172-a897-a5ef171b9cea/ui-redesign-verification/u3/geometry-results/`.

The local development app remains at `http://localhost:3000` for owner review. This phase uses focused Chromium/component verification; historical full-suite and cross-engine evidence remains in earlier reports and was not rerun or relabeled. No production deployment, provider/account/data mutation, commit, push, dependency change or paid service was performed. Owner visual acceptance remains pending.
