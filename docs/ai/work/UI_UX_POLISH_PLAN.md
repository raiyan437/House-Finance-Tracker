# UI/UX Polish Plan - presentation-only refinements

**Status (2026-08-23): implemented and verified.** See the "Result" section at the end for deviations discovered during implementation. The owner reviewed the Dashboard/UX assessment and approved items 1, 2, 3, 4, 6, 7, 8, 9, and 10 (dark mode was deliberately excluded as a future product decision). All items are presentation-layer only: no domain rules, application services, persistence schemas, financial arithmetic, permissions, or privacy behavior change.

## Intended outcome

A dashboard and shell that feel faster during month switching, survive real-world content sizes without clipping, guide users out of empty states, reduce mobile scroll burden, expose faster month stepping, read more clearly in the charts, animate metric changes subtly, and cannot ship development tooling to production. Type-scale drift is consolidated into named tokens so future screens stop accreting one-off pixel values.

## Items

### 1. Stale-while-revalidate month switching (Dashboard)

`dashboard-page.client.tsx`. Keep the last ready `DashboardPageView` mounted while a new month request is in flight: render it dimmed (`opacity`, `aria-busy`, non-interactive) instead of replacing the whole grid with `LoadingState`. A compact inline loading indicator appears next to the month controls; full `LoadingState` remains for first load and error retry paths. Request-key race protection is unchanged.

### 2. Type-scale token consolidation

`globals.css` `@theme` gains named text-size tokens whose behavior matches Tailwind arbitrary sizes exactly (font-size only, no injected line-height): `--text-mini: 0.625rem` (was `text-[10px]`), `--text-fine: 0.6875rem` (was `text-[11px]` / `[0.6875rem]`), `--text-row: 0.8125rem` (was `text-[13px]`). The 24 existing occurrences in the presentation layer are replaced mechanically with no computed-style change. New code should use the named tokens.

### 3. Content-driven heights (no clipping)

Fixed heights become floors: Dashboard summary cards `h-36` → `min-h-36`; Recent Expenses panel `h-[366px]` → `min-h-[366px]`; every fixed `height:` in the `>=1400px` media block (expense overview/details/private/split/receipts/activity panels) becomes `min-height:`. Chart canvases keep bounded heights because Recharts requires a definite box. Visual parity holds whenever content fits; taller content now grows its surface instead of drawing past the border (same lesson as the 2026-08-22 form-panel correction).

### 4. Richer empty states

New `presentation/components/empty-state.tsx`: icon disc + message + optional CTA. Applied to Member Contributions ("No expenses recorded for this month yet." + Add Expense CTA), the compact ExpenseSummaryList empty message (+ Add Expense CTA via new optional prop), and the Payment Mix zero state (icon + existing text). Exact existing message strings are preserved because component tests assert them; CTAs link to the existing `/expenses/new` route.

### 6. Mobile density: collapsible dashboard sections

New `presentation/components/mobile-collapse.tsx`: a chevron toggle visible below `md` that collapses a section's body on mobile/tablet while desktop rendering is unaffected (`max-md:hidden` button, `max-md:hidden` body when collapsed). Default is expanded, chosen deliberately over matchMedia-default-collapsed to avoid a post-hydration content jump; users gain one-tap scroll control. Applied to Housemate Balances, Recent Expenses, and Payment Mix panels.

### 7. Month stepper

`calendar-month.ts` gains pure `nextCalendarMonth` (mirroring existing `previousCalendarMonth`). `MonthSelector` renders ChevronLeft/ChevronRight buttons flanking the select. When `options` are provided, stepping clamps to the available range (buttons disable at the ends) so the selector never emits a month outside the reconstructed data window; keyboard operability comes from native buttons. Aria labels: "Previous month" / "Next month".

### 8. Chart readability refinements

`analytics-charts-recharts.client.tsx`, fed by an optional new `month?: CalendarMonth` prop passed from both Dashboard and Monthly Report:
- Weekend bars use a slightly darker neutral fill than weekday bars, so weekly rhythm reads without a legend.
- When the selected month is the current month, today's bar uses the brand fill (replacing the previous unconditional last-day highlight, which marked day 31 even mid-month).
- Non-compact Payment Mix slices show percentage labels directly on the chart; the compact variant keeps its adjacent textual Cash/Card percentage rows as the non-color channel.

Exact textual summaries remain the accessible source of truth; all chart animation stays disabled.

### 9. Subtle metric-value transitions

Dashboard metric numbers (Spent, You Owe / You Are Owed, Settlement Health counts) re-mount keyed by their value with a small `tw-animate-css` fade/slide-in. The global `prefers-reduced-motion` rule already neutralizes animation durations, and `motion-safe:` prefixes keep the intent explicit. No numeric logic is touched.

### 10. Development tools production gate

`development-tools.tsx` exports `developmentToolsEnabled = process.env.NODE_ENV !== "production"`; both tool components return `null` when it is false, and the desktop sidebar skips its dev-tools footer strip entirely in production builds. Next.js compile-time replacement makes the gate static; tests stub the environment value to prove both render paths.

## Explicit exclusions

Dark mode (item 5; deferred product decision), any domain/application/persistence change, new dependencies, Playwright scope expansion beyond the existing analytics suite if regression risk warrants it.

## Verification

Focused Vitest files → full Vitest → lint → typecheck. Component tests added for: stepper clamping/emission, empty-state CTA links, collapsible toggle semantics, and the production gate. Dev server smoke check locally at the end. `PROJECT_STATE.md` and `ACTIVE_PLAN.md` updated after green verification.

## Result (2026-08-23)

All nine items implemented as planned, with two corrections discovered during verification:

1. **Item 10 gate redesigned to honor the frozen architecture rule.** The original plan placed a `process.env.NODE_ENV` check in `development-tools.tsx`; the architecture guard correctly rejected it because environment branching is isolated to `app/_providers/local-application-runtime.client.tsx`. The composition root already passes `undefined` to `DevelopmentToolsProvider` outside development, so both tool components already render nothing in production. The remaining real gap was cosmetic: the desktop sidebar's dev-tools footer strip stayed visible around a null child. Fixed presentation-side with `useDevelopmentToolsActive()` (context presence, no env branching); tests now prove render/no-render from provider presence instead of stubbed environments.
2. **Item 8 tick rendering changed from element to renderer function.** Weekend-aware ticks require per-tick props, so `XAxis.tick` is now a function; full delegation semantics (`interval={0}`, every day rendered) are unchanged and re-asserted. The previous unconditional last-day bar highlight was replaced by the today marker for the current month; without a `month` prop the legacy last-day highlight remains.

Additional outcomes: `nextCalendarMonth` added beside `previousCalendarMonth`; type tokens `text-mini/text-fine/text-row/text-stat` replaced all 24 arbitrary size utilities with zero computed-style drift (font-size-only tokens, no injected line-heights); Payment Mix percentage labels are rounded display values on the decorative chart only — exact basis-point percentages remain in the textual rows and summaries.

**Verification:** full Vitest green at 486/486 across 61 files (10 new tests: stepper emission/clamping, empty-state CTAs, collapse toggle semantics, weekend derivation, production gate); lint and TypeScript clean. Analytics Chromium e2e passed 10/10 including responsive geometry and Axe checks after the changes. Dev-server smoke check passed locally.

**Amendment (2026-08-23, owner request):** the Add Expense CTA was removed from the Member Contributions empty state per owner decision — that card now shows only the icon and message; the Recent Expenses empty state keeps its CTA. Component coverage asserts exactly one dashboard "Add Expense" link (Recent Expenses) and none inside the Member Contributions section. Full Vitest 486/486, lint/typecheck clean after the change; no other behavior affected.

**Amendment (2026-08-23, owner-reported layout defects):** the Member Contributions card had been missed by the fixed-height-to-floor conversion and stayed `h-36`, so its grey empty-state box overflowed past the card border while sibling cards stretched — fixed by converting the card to `flex min-h-36 flex-col` and making the empty box fill the leftover height (`flex-1`) as a centered horizontal icon/message row with tightened padding, so its bottom edge lands exactly on the card padding line at every width. The Recent Expenses empty state ("No expenses this month" + Add Expense) now centers vertically and horizontally inside its panel via a flex body wrapper and a `flex-1 items-center justify-center` empty container. Vitest 486/486, lint/typecheck clean after both fixes.

**Amendment (2026-08-23, owner follow-up):** the Member Contributions empty state dropped its grey surface entirely (`bg-transparent p-0` overrides over the CardEmptyState base) while keeping the centered icon/message content and the card's own padding as spacing; and the Add/Edit Expense detail fields (Expense Name, Amount, Expense Date, Paid By) widened their label-to-control gap from `space-y-1` (4px) to `space-y-2` (8px), matching the existing "Your Card" field rhythm. Vitest 486/486, lint/typecheck clean after both changes.

**Amendment (2026-08-23, owner-reported regression):** the Recent Expenses amounts had drifted off the right edge because the previous centering fix made the collapse body a row-direction flex container, shrinking the expense list to content width. The body is now `flex flex-col` — the list stretches full width again so compact amounts align right — and the compact amount paragraph carries explicit `text-right`. Analytics suites 16/16, typecheck/lint clean.
