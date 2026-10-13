# U5 dropdown dismissal and Household avatar containment — local verification

Owner-authorized scope on 2026-10-12: fix dropdown closing lag throughout the interface and remove extra member avatars above/overlapping the Household top bar. The owner clarified that the top-right Profile button must remain.

## Findings and implementation

The shared DropdownMenu and Select primitives applied a 150ms CSS exit animation. Radix Presence retains their closed content until that animation ends. A representative Chromium notification-menu probe observed `exit` at `0.15s`, with removal approximately 163ms after instrumentation began. Removing only the closed-state animation utilities preserves the existing 150ms fade/zoom opening but allows immediate dismissal. The same local probe afterward observed removal at approximately 11ms, with no closed animation. These are illustrative local observations, not latency guarantees.

The DatePicker already animates only opening and needed no implementation change. Dropdown handlers, modal settings, focus restoration, keyboard semantics, field values and notification commands remain unchanged.

Current Household markup already omitted the former decorative member row after U4; the inspected local browser also showed no extra row. The shared decorative-avatar style is now hidden by default and enabled only inside Dashboard. This prevents that Dashboard-only decoration appearing on Household or other routes, including route-loading contexts. The header Profile, House Leader avatar and Members list remain unchanged.

Only shared presentation class strings and decorative CSS were changed. Domain, money arithmetic, application services, persistence, API, provider settings, permissions, dependencies and session logic were not edited. React review found no added hooks, effects, fetching or state changes.

## Verification

- Existing Select, DatePicker, Navigation and Household UI suites: 27/27 pass across four files.
- TypeScript passes; targeted ESLint passes with zero warnings; Git whitespace checks pass.
- Twelve distinct browser cases are successfully covered across Chromium, Firefox and WebKit: the new U5 dropdown/Household regression plus existing notification keyboard/history, recipient isolation across identity/navigation changes, and navigation-motion/draft/reduced-motion checks.
- Final corrected U5 run: 3/3 pass. It checks notification menus at desktop/mobile sizes, Dashboard month selection, Household member menus, all four Expense filter selects and the Expense Date picker. Repeat trigger clicks, Escape and outside clicks dismiss content; opening remains `enter` at 150ms; no exit animation starts; values remain unchanged and keyboard/repeat-click focus returns to the trigger. Reduced-motion notification opening remains 1ms with immediate Escape dismissal.
- Dashboard retains its decorative member tray. Navigation to Household at 1440x900 and 390x844 shows no extra tray, exactly one header avatar, and the accessible Profile link. Desktop/mobile screenshots were visually inspected.
- Initial U5 test iterations exposed test-input issues: a calendar coordinate was captured before focus-driven scrolling, and a later helper tried to query modal-hidden background triggers. The helper now uses locator clicks for the nonmodal calendar and captures modal trigger attributes/geometry before opening. The final three-engine check passes. The nine existing browser cases passed in the preceding broader run; no failed iteration is counted as a pass.
- Artifacts are retained outside Git under `C:/Users/raiya/.codex/visualizations/2026/10/12/01a12fe3-ed2f-7aa1-b3ce-8934266bc625/u5-verification/`.

Browser checks used isolated synthetic fixtures against the local IndexedDB development app. Full financial suites and optimized builds were not rerun for these focused presentation edits. Existing uncommitted work is preserved. No commit, push, deployment, provider/data operation or subsequent phase was performed. The local app remains at `http://localhost:3000` for owner review.
