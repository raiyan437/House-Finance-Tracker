# U8 Dashboard, Expense columns and click motion — local verification

Owner-authorized scope on 2026-10-12: center the Dashboard month label and calendar/dropdown icons between the arrows, add signed green/red balance pills matching the supplied reference, correct Expense column spacing, and add click micro-animations throughout the interface.

## Implementation

- Dashboard month contents form one centered group with symmetric spacing. The label remains fully visible, and the calendar is visible on mobile. Existing dropdown options, chevron bounds, month state and query behavior are unchanged.
- Housemate Balance amounts retain the exact existing signs/BDT formatter and Gets back/Owes/Settled labels. Existing success/danger tokens provide green/red text and soft pill backgrounds; zero is neutral. Amount padding does not consume the existing text allowance, and large values retain their wrapping behavior.
- Expense headers and desktop rows use one proportional grid for eight columns. Settlement-through-Split cells align centrally within matching tracks, Amount stays right-aligned, and focus no longer introduces a row-only horizontal margin. Mobile expense cards retain their existing metadata and behavior.
- Buttons, links, semantic controls, checkbox/radio labels and expense rows gain short press/release feedback. Popup anchors and popup items use highlight feedback, with existing opening and chevron animation retained. Reduced motion disables scale/translation and minimizes transition/animation duration. No JS click handler, timer, duplicate command or deferred action was added.

The presentation-only requirements amendment records the owner's authorization. Implementation changes are limited to shared CSS and Dashboard/Expense presentation class strings plus a safe existing balance-state attribute. Domain, money calculations, application services, persistence, API, session handling, provider configuration, permissions and dependencies were not edited. Earlier uncommitted work is preserved.

## Verification

- Existing analytics, Receipt UI, Navigation, Select and DatePicker component suites: 38/38 pass across five files.
- Final TypeScript, targeted ESLint with zero warnings and Git whitespace checks pass. React review found no added hooks, effects, fetching, state ownership changes or client/server boundary changes.
- Final browser run: 24/24 pass across Chromium, Firefox and WebKit. Coverage includes the two U8 layout/motion regressions, retained immediate dropdown dismissal, navigation/draft/reduced-motion behavior, Expense filter composition and keyboard details navigation, validation/focus, Card owner isolation, and cross-identity Settlement confirmation/history.
- Six additional month-completeness and large-balance/long-name cases passed across all three engines earlier in this phase, yielding 30 distinct successful browser cases. Those earlier checks include responsive reflow and serious/critical Axe assertions.
- Month geometry checks cover 320/390/768/1024/1440/1920px: icon/label centers align between the arrow buttons within 1px, the calendar remains visible, the label does not clip and the page does not overflow. Expense grid checks cover 390/768/900/1024/1280/1440/1920px; desktop header/cell edges and widths agree within 1px, including keyboard focus, and mobile cards remain intact.
- Held mouse input proves press feedback starts before the action and a released month click advances once. Popup anchors retain identical rectangles while open; reduced motion leaves scale/translation disabled without blocking the action. Signed colors/text remain correct. The mobile balance view has no serious/critical Axe findings.
- Desktop/month/balance and Expense screenshots were visually inspected. Artifacts are retained outside Git under `C:/Users/raiya/.codex/visualizations/2026/10/12/01a12fe3-ed2f-7aa1-b3ce-8934266bc625/u8-verification/`.

## Diagnosed verification issues

The first Chromium month measurement required exactly 16px while the existing optional page-entry scale was still finishing; the measured width was 15.98px. A 0.5px size tolerance retains the visible-calendar assertion, and the corrected check passes.

Additional WebKit filter checks repeatedly reported an unsuppressed ResizeObserver warning. Instrumentation traced changing combobox/popup widths to press scaling: Radix Select's trigger has an implicit popup role and no explicit `aria-haspopup`, so the initial anchor guard missed it. The corrected guard includes combobox triggers, and popup feedback uses highlights with stationary geometry. Filter composition and all final browser checks pass without error filtering or suppression. A separate initial fixture navigation interruption passed serially and in the final aggregate.

All browser data was synthetic and isolated against local IndexedDB composition. Full financial unit suites and optimized builds were not rerun for these presentation edits. No commit, push, deployment, provider/data operation or next phase was performed. The local app remains at `http://localhost:3000` for owner review.
