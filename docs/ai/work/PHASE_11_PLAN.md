# Phase 11 Plan — Dashboard, Analytics, and Monthly Reports

## Status and authorization

Phase 10 is accepted and committed as `c3585fe`. Phase 11 implementation was explicitly approved and authorized by the user on 2026-08-19 with the clarifications in this document frozen. Phase 11 implementation and verification are complete and intentionally uncommitted for review. Do not begin Phase 12.

## Objective and exit outcome

Complete the remaining primary local-MVP product UI with the approved Dashboard and a Dashboard-linked Monthly Report, while deriving every displayed value from existing source records and canonical financial engines:

```text
Expenses + canonical allocations
Memberships + profiles
Settlements
        ↓
pure monthly analytics + existing current-balance engine
        ↓
presentation-safe Dashboard / Monthly Report views
        ↓
responsive, accessible React + Recharts UI
```

Exit requires exact integer-poisha aggregation, Expense Date month bucketing, a strict separation between selected-month spending and the current unresolved household position, Card-safe projections, dynamic Gregorian daily data, accessible Recharts output plus textual summaries, Dashboard and report responsive behavior, comprehensive regression coverage, and updated AIDOS evidence.

## Exact scope

- Replace the `/dashboard` placeholder with the canonical Soft Premium Finance Dashboard. Keep an `sr-only` page heading for document structure, but add no visible `Overview`, `Dashboard` heading, descriptive subtitle, Household-name hero, Add Expense button, or generic “Dashboard sections” label.
- Render the top control row as the selected-month control followed by current active Household member avatars/initials. Use the existing deterministic `MemberAvatar`; do not add external or generated images.
- Add selected-month `Spent`, daily `Spending Trend`, `Payment Mix`, and `Recent Expenses` modules based on non-deleted Expenses and `expenseDate`.
- Add current-state `Outstanding`, `Settlement Health`, and `Housemate Balances` modules based on the existing full Household balance sheet, deterministic settlement recommendations, and current Pending Settlement records. These modules never change merely because the selected Dashboard month changes.
- Keep `Outstanding` as one top-level card containing `You Owe` and `You Are Owed` sub-values.
- Add `/reports/monthly?month=YYYY-MM` as a Household-gated secondary route with no sidebar or mobile-navigation destination.
- Add a quiet `View Monthly Report` link inside the selected-month `Spent` card. It carries the selected month to `/reports/monthly?month=YYYY-MM` without changing the canonical Dashboard control row.
- Add `View All Expenses` after the Recent Expenses list and link to `/expenses?month=YYYY-MM`; make the Expenses page honor a single valid month query as its initial month filter, while retaining its current-month default for absent or invalid input.
- Add a Monthly Report with Month, Total Spending, Expense Count, Month-over-Month Spending Change, Daily Spending Trend, Payment Mix, Member Contributions / Amount Paid, Member Expense Shares, Largest Expenses, and Settlement Summary.
- Add Recharts as the first charting dependency and use it only in narrow Client Components. Keep all aggregation, date, ordering, percentage, and financial logic outside React and Recharts.
- Re-read source records whenever a Dashboard/report view is requested. Do not patch totals in component state after Expense, Settlement, membership, or identity mutations.
- Preserve the existing active-Household gate, local persistence, current runtime reconstruction, privacy constraints, and exact finance engines.

## Explicit exclusions

- Expense categories, category filters, or category analytics.
- Budgets, recurring expenses, forecasts, goals, or AI insights.
- Export, sharing, print/PDF generation, notifications, reminders, or email.
- Multiple currencies, currency conversion, multiple households, or Household switching.
- Custom report builders, custom chart builders, saved report definitions, or persisted filters.
- Persisted Dashboard totals, chart datasets, monthly aggregates, payment-mix totals, report totals, or member balance snapshots.
- Historical month-end balance reconstruction or claims that the current outstanding position was the position at the end of a selected month.
- New settlement states, arbitrary settlements, balance forgiveness, or changes to confirmed-settlement immutability.
- Card names, Card types, Card colors, Card IDs, or private Card snapshots in Dashboard/report projections.
- Appwrite, production authentication, deployment, server analytics, telemetry, or paid services.
- A Monthly Reports sidebar/mobile-navigation item.
- A visible Dashboard title/hero/CTA block or redesign of the approved Dashboard.

## Proposed routes

| Route | Purpose | Navigation behavior |
| --- | --- | --- |
| `/dashboard` | Canonical primary Dashboard | Existing primary navigation destination; selected month is ephemeral page state and defaults to the current local calendar month. |
| `/reports/monthly?month=YYYY-MM` | Monthly Report for the selected month | Secondary route reached from the Dashboard only; no sidebar/bottom-navigation item. The query makes report links refresh-safe and shareable within the local app. |
| `/expenses?month=YYYY-MM` | Existing Expenses page initialized to the Dashboard month | Target of `View All Expenses`; no new route or feature destination. |

`/reports` and descendants join the existing Household-required route prefixes. Route pages remain Server Components. Client-only local data and Recharts stay below explicit Client Component boundaries. Any `useSearchParams` consumer is placed under a `Suspense` fallback, consistent with the installed Next.js 16.3 guidance; alternatively, a Server page may await `searchParams` and pass only a validated string. The preferred implementation is the narrow `useSearchParams` + `Suspense` boundary so the route shell remains statically renderable.

## Dashboard component hierarchy

```text
src/app/(product)/dashboard/page.tsx                 thin Server Component
└── DashboardPageClient                              keyed by viewer + Household
    ├── sr-only h1: Dashboard
    ├── DashboardLoadingState / DashboardErrorState
    ├── DashboardControlRow
    │   ├── MonthSelector                            Calendar + Month Year + Chevron
    │   └── ActiveMemberAvatarGroup                  active members only
    ├── DashboardSummaryGrid
    │   ├── SpentCard                                selected month
    │   │   └── View Monthly Report
    │   ├── OutstandingCard                          current state
    │   │   ├── You Owe
    │   │   └── You Are Owed
    │   └── SettlementHealthCard                     current state
    ├── DashboardAnalyticsGrid
    │   ├── SpendingTrendCard                        selected month
    │   │   └── DailySpendingBarChart
    │   └── PaymentMixCard                           selected month
    │       └── PaymentMixDonut + Cash/Card text rows
    └── DashboardBottomGrid
        ├── HousemateBalancesCard                    current state
        │   └── HousemateBalanceRow[]
        └── RecentExpensesCard                       selected month
            ├── RecentExpenseRow[]
            └── View All Expenses
```

The Dashboard follows the canonical desktop rhythm: summary cards, a two-column analytics row, then bottom panels. The top row contains only the selected-month control and member avatars.

## Monthly Report component hierarchy

```text
src/app/(product)/reports/monthly/page.tsx            Server Component + Suspense
└── MonthlyReportPageClient                           Household-gated client view
    ├── ReportHeader
    │   ├── Back to Dashboard
    │   ├── h1: Monthly Report
    │   └── MonthSelector
    ├── ReportLoadingState / ReportErrorState
    ├── ReportSummaryGrid
    │   ├── TotalSpendingCard
    │   ├── ExpenseCountCard
    │   └── MonthComparisonCard
    ├── ReportAnalyticsGrid
    │   ├── DailySpendingTrendCard
    │   └── PaymentMixCard
    ├── MemberContributionShareCard
    │   └── MemberPaidShareRow[]                      Paid and Share side by side
    ├── LargestExpensesCard
    │   └── LargestExpenseRow[]
    └── SettlementSummaryCard
        ├── Created / Confirmed / Rejected / Cancelled activity
        └── Current outstanding note and values
```

The report may have a visible `Monthly Report` heading because the prohibition applies to the canonical Dashboard hero. It remains a secondary, focused report rather than a new analytics application.

## Calendar-month model and selector behavior

- Introduce a validated `CalendarMonth` value shaped as `YYYY-MM`. Calendar arithmetic is Gregorian, date-only, and independent of UTC conversion for Expenses.
- Dashboard default: the viewer device's current local calendar month at client initialization. Identity or Household changes key the page and reset the Dashboard selection to that current local month.
- Monthly Report default: one single valid `month` query value; otherwise the current local month. Invalid, duplicated, or array-shaped query input is ignored and canonicalized to the current month without an error page.
- The collapsed selector is a minimum-44px button with a Lucide Calendar icon, localized English `Month YYYY` text, and a Lucide downward chevron, all vertically centered with stable gaps.
- The dropdown contains the current local month plus every distinct source-relevant month, newest first. Relevant months are non-deleted Expense Dates and Settlement `createdAt`/`resolvedAt` local-calendar months. The currently selected month is always present even when empty. No enormous generated range of intervening months is created.
- A user selects one month with pointer, touch, Enter, or Space; Escape closes and restores trigger focus. Arrow-key behavior comes from the existing Radix dropdown primitive.
- Dashboard selection changes component state only. Report selection also updates `?month=YYYY-MM` with `router.replace(..., { scroll: false })` so refresh/back behavior remains coherent.
- Expense dates are matched by exact `expenseDate.slice(0, 7)`. They are never parsed through `Date` and never bucketed from `createdAt`.
- Settlement instants have no Household timezone field. Proposed Phase 11 rule: bucket settlement `createdAt` and `resolvedAt` by the current viewer's local timezone, matching existing timestamp presentation. This is called out for approval under Risks.

## Application analytics and use-case architecture

### Pure functions

Create a pure, framework-independent analytics module under `src/application/analytics/` (exact filenames may consolidate without changing the boundaries):

```text
calendarMonth(value)
previousCalendarMonth(month)
daysInCalendarMonth(month)
filterMonthlyExpenses(expenses, month)
calculateMonthlySpending(expenses, month)
calculateDailySpending(expenses, month)
calculatePaymentMix(expenses, month)
calculateMemberContributions(expenses, month)
calculateMemberShares(expenses, month)
calculateLargestExpenses(expenses, month, limit)
calculateMonthComparison(expenses, month)
calculateSettlementActivity(settlements, month, localMonthOfInstant)
```

- Functions accept source records or deliberately narrow source shapes and return immutable values.
- Every money sum uses integer poisha with `BigInt` working values and checked conversion back to the existing safe-integer `Poisha` type.
- Percentage/proportion calculations use integer basis points (`10,000 = 100%`) and deterministic integer remainder allocation. Floating point is not used for money or proportions.
- No function imports React, Recharts, IndexedDB, browser persistence, formatting helpers, or presentation components.
- Existing `calculateHouseholdBalances()` and `generateSettlementRecommendations()` remain the sole current-position engines; Phase 11 does not clone their logic.

### Read use cases and projections

Add one read-only `HouseholdAnalyticsApplicationService` with methods conceptually equivalent to:

```text
getDashboardPage(householdId, selectedMonth)
getMonthlyReportPage(householdId, selectedMonth, localMonthOfInstant)
```

Each call:

1. resolves the current actor and requires their active membership in the requested Household;
2. loads Household membership history, profiles, non-deleted and historical Expense source records, and Settlement records through existing repository ports;
3. builds one in-memory source snapshot and derives every module from that same snapshot;
4. uses all non-deleted Expenses plus Confirmed Settlements for the current balance sheet;
5. uses the selected-month non-deleted Expense subset for spending analytics;
6. returns a narrow immutable presentation view with generic `cash | card` methods only.

No repository method, IndexedDB schema/version, index, object store, record envelope, or write transaction is added merely for analytics. The existing Household-indexed reads are sufficient for the local MVP. If later profiling proves a read bottleneck, caching/materialized views require a separate approved design.

Expose only `analyticsActions.getDashboard(...)` and `analyticsActions.getMonthlyReport(...)` through the existing runtime context. Recharts and React never receive repositories or raw persistence records.

### Refresh and stale-response behavior

- Expense create/edit/delete, Settlement confirmation, and membership mutations already persist then reconstruct or navigate. Returning to Dashboard/report mounts a new read and derives all values from source records.
- Identity changes and Household changes key the analytics subtree and trigger a fresh read.
- Month changes issue a fresh use-case call. A monotonic request token ignores any older response that resolves after a newer identity/Household/month request.
- Components do not increment/decrement totals or mutate chart arrays after writes.
- No cross-tab live synchronization is added; that remains an approved local-MVP exclusion. Manual retry/remount always rereads authoritative local source records.

## Exact Dashboard metric semantics

### Selected Month

- A `CalendarMonth` chosen by the selector; default is the current local month.
- It filters only Spent, Spending Trend, Payment Mix, and Recent Expenses.

### Spent

- Sum `expense.amount` for every Expense in the active Household where `deletedAt` is absent and `expenseDate` belongs to the selected month.
- Include every payer, participant set, split method, Cash/Card method, and former-member historical Expense that meets those rules.
- Do not subtract shares or Settlements. This is gross Household spending, not the viewer's share.
- Format only at presentation as BDT with two decimal places and tabular numerals.

### Outstanding

- Derive the current viewer's one net balance from the existing current Household balance sheet, with no month filter.
- `You Owe = abs(balance)` only when the viewer balance is negative; otherwise zero.
- `You Are Owed = balance` only when it is positive; otherwise zero.
- Both values are rendered inside one `Outstanding` card. Under the approved net model, at most one is non-zero.

### Settlement Health

- `outstanding` = the number of current full deterministic Settlement recommendation edges whose unordered member pair does not already have an active Pending Settlement.
- `pending` = the number of Settlement records in the Household whose current status is exactly `pending` at read time.
- Both are Household-wide, current-state counts and are not filtered by selected month or current user.
- A recommendation for `A -> B` plus an active Pending claim for unordered pair `A <-> B` contributes zero Outstanding and one Pending, even when the Pending claim is stale. The existing claim must become terminal before another Pending claim for the pair can exist.
- Terminal Confirmed, Rejected, and Cancelled records do not count as Pending. Confirmed records affect the balance engine and may thereby change the recommendation count.
- Display factual text such as `2 outstanding` and `1 pending`; no percentage, score, grade, color-only state, or invented health model.

### Spending Trend

- Daily gross Household Expense totals for the selected month, using non-deleted Expenses and Expense Date.
- Exactly one immutable data point exists for every valid day from 1 through the month's Gregorian day count, including zero-poisha days.
- February has 28 days except Gregorian leap years (divisible by 4, excluding centuries unless divisible by 400); April/June/September/November have 30; all others 31.
- The BarChart receives points in ascending day order. The X-axis domain/data begins at day 1 and ends at the final valid day with zero outer category padding; responsive tick thinning may hide intermediate labels, but no bar/data point is removed.
- Tooltip and textual summary use exact BDT formatting. Chart components never recompute totals.

### Payment Mix

- `cashPoisha` = selected-month non-deleted Expense amounts whose public method is Cash.
- `cardPoisha` = selected-month non-deleted Expense amounts whose public method is Card.
- `cashPoisha + cardPoisha = Spent` is asserted.
- Proportions are integer basis points totaling exactly 10,000 when Spent is positive. Allocate any remainder by largest fractional remainder, with Cash before Card as the final deterministic tie-break.
- When Spent is zero, both totals and both proportions are zero and the chart shows a factual no-spending empty state rather than a fabricated 50/50 split.
- Render a compact two-segment Recharts donut plus aligned Lucide `Banknote`/Cash and `CreditCard` rows showing label, exact amount, and percentage. Text remains authoritative; color is supplementary.

### Member Avatars

- Include current active Household memberships only.
- Order Leader first, then active Members by display-name code-point order, then stable user ID; reuse the accepted Household ordering semantics.
- Render deterministic initials through `MemberAvatar`. The visual avatars are decorative; an accessible group name or visually hidden member-name list supplies the semantic equivalent.
- On narrow screens, show as many avatars as fit and a textual `+N` overflow indicator; the full accessible name list remains available. No external image request occurs.

### Housemate Balances

- Start from the current complete Household balance sheet with all retained membership history, then display current active members only.
- Positive: label `Gets back` and present `+৳…`.
- Negative: label `Owes` and present `-৳…`.
- Zero: label `Settled` and present `৳0.00`.
- Deterministic order: current viewer first; remaining members by state priority `Gets back`, `Owes`, `Settled`; within non-zero groups by absolute balance descending; then display-name code-point order; finally stable user ID.
- Do not persist values or use accounting terms such as debit/credit.

### Recent Expenses

- Take the first five non-deleted selected-month Expenses after sorting by Expense Date descending, then `createdAt` descending, then `expenseId` ascending.
- Each row shows name, Expense Date, payer display name (`You` for the viewer), generic `Cash` or `Card`, and exact amount.
- Former payer names remain visible with `Former member` text when historical membership requires it.
- Dashboard rows never contain or render Card name, type, color, ID, or private snapshot, even for the owner. `Card` is the complete Dashboard payment label.
- Each row links to the authorized Expense Details route. `View All Expenses` is a separate footer action after the list and links to `/expenses?month=YYYY-MM`; layout flow, not absolute positioning, guarantees it cannot overlap content.

## Monthly Report calculation rules

### Month, Total Spending, and Expense Count

- Month is the selected `CalendarMonth` formatted `Month YYYY`.
- Total Spending is identical to Dashboard Spent for the same source snapshot and month.
- Expense Count is the count of those same non-deleted selected-month Expenses, regardless of amount distribution, split method, or payer.

### Month-over-Month Spending Change

- Compare selected-month Total Spending with the immediately previous calendar month's Total Spending; January compares with December of the preceding year.
- `deltaPoisha = selectedPoisha - previousPoisha` using exact integer poisha.
- If previous spending is positive, derive a signed percentage in integer basis points as `delta * 10,000 / previous`, rounded to nearest basis point with exact BigInt half-away-from-zero behavior. Display direction, percentage, and exact BDT delta.
- If previous is positive and delta is zero: `No change from previous month` and `0.00%`.
- If previous is zero and selected is zero: `No spending in either month`; no percentage.
- If previous is zero and selected is positive: `No previous-month spending` plus the exact positive BDT difference; never render infinity, `NaN`, or an invented 100% increase.

### Daily Spending Trend and Payment Mix

- Reuse the exact Dashboard pure functions, view types, chart components, zero behavior, and accessible summaries for the selected report month.

### Member Contributions / Amount Paid and Expense Shares

- `Amount Paid` for a member = sum of selected-month Expense amounts whose `payerId` is that member.
- `Expense Share` for a member = sum of every canonical selected-month allocation whose `participantId` is that member, including explicit zero-poisha allocations.
- Do not use current balances or Settlements to derive either value.
- Include each member who paid or was allocated any selected-month Expense. Retained former members are included and labelled when source Expenses reference them; unrelated zero-activity historical members are omitted.
- Assert total member Amount Paid equals Total Spending and total member Expense Share equals Total Spending.
- Order by Amount Paid descending, Expense Share descending, display-name code-point order, then stable user ID.
- Render `Paid` and `Share` as distinct labelled fields in every row; never collapse them into one contribution number.

### Largest Expenses

- Use the same non-deleted selected-month Expense set.
- Show at most five.
- Sort by Amount descending, then Expense Date descending, then `createdAt` descending, then `expenseId` ascending.
- Show Expense name, Expense Date, payer, generic Cash/Card, and amount. Do not add categories.

### Settlement Summary

Settlement activity and current outstanding position are separate sections within the summary:

- `Claims created`: Settlement records whose `createdAt` falls in the selected viewer-local calendar month; show count and exact total claimed amount regardless of eventual status.
- `Confirmed`: records with status `confirmed` whose `resolvedAt` falls in the selected month; show count and exact total confirmed amount. A claim created in an earlier month but confirmed in the selected month counts here.
- `Rejected`: records with status `rejected` whose `resolvedAt` falls in the selected month; show count. Their amounts have no balance effect.
- `Cancelled`: records with status `cancelled` whose `resolvedAt` falls in the selected month; show count. Their amounts have no balance effect.
- `Current outstanding`: current recommendation count and total recommended amount from today's source snapshot, explicitly labelled `Current position — not a month-end balance`.
- A record may legitimately appear in both `Claims created` and one resolution bucket when both events occurred in the selected month; the labels describe events rather than mutually exclusive accounting categories.
- Never infer a historical month-end balance, assign Settlements to Expense months, or treat rejected/cancelled/pending amounts as confirmed financial effects.

## Presentation-safe views

Conceptual immutable shapes:

```text
DashboardPageView
  selectedMonth
  monthOptions[]
  members[]                           active only; name + initials-safe identity
  spentPoisha
  outstanding { youOwe, youAreOwed }
  settlementHealth { outstandingCount, pendingCount }
  dailySpending[]                     day + amountPoisha
  paymentMix { cash, card, cashBasisPoints, cardBasisPoints }
  housemateBalances[]                 active only; label + signed amount
  recentExpenses[]                    public payment method only

MonthlyReportPageView
  selectedMonth
  monthOptions[]
  totalSpendingPoisha
  expenseCount
  comparison
  dailySpending[]
  paymentMix
  memberPaidShares[]
  largestExpenses[]
  settlementActivity
  currentOutstanding
```

No view contains repositories, IndexedDB records/envelopes, receipt bytes, broad audit data, private Card references/snapshots, persisted aggregate fields, or members from another Household.

## Recharts integration plan

- Add the current stable Recharts v3 package as a pinned runtime dependency and update the lockfile only after implementation approval. Recharts' current peer range includes React 19; verify the actual installed dependency tree, build, and audit at implementation time.
- Use `ResponsiveContainer` inside an explicitly sized, `min-w-0` parent so charts take available width without forcing horizontal overflow.
- Daily trend: `BarChart`, `Bar`, `CartesianGrid`, `XAxis`, `YAxis`, and a BDT `Tooltip`; no line/area/composed chart.
- Payment mix: `PieChart`, `Pie`, `Cell`, and a BDT `Tooltip`; the donut is secondary to the visible Cash/Card textual rows.
- Set `accessibilityLayer` explicitly, provide labelled `figure`/description relationships, and retain `ChartCard` textual summaries. Keyboard chart interaction supplements rather than replaces the text summary.
- Set `isAnimationActive={false}` for deterministic financial presentation, reduced-motion safety, and stable tests. No custom motion hook or chart engine is needed.
- Keep chart imports inside `"use client"` presentation modules. Server route files and pure analytics modules never import Recharts.
- Unit-test chart inputs, not Recharts internals. Component/Playwright tests verify rendered labels, summaries, resize behavior, keyboard reachability, and absence of overflow.

## Loading, error, and empty states

- Initial Dashboard/report load: shape-matched skeletons for controls, summary cards, chart cards, and bottom/report panels with one polite status announcement.
- Month switch: update the selected-month label immediately, mark the view `aria-busy`, and replace month-dependent values/charts/lists with scoped skeletons. Current-state Dashboard cards may remain visible but are refreshed from the same new read. Never display old-month figures under a new-month label.
- Error: retain the selected month, show one clear error Surface with `Try Again`, and avoid partial financial figures from a failed projection. Retry performs a complete source reread.
- Selected month with no Expenses: Spent `৳0.00`, Expense Count `0`, a full all-zero daily dataset, Payment Mix no-spending state with both textual totals zero, no Recent/Largest Expenses message, and any valid current-state balance/settlement modules still render.
- No current obligations: both Outstanding values zero; Settlement Health reports `0 outstanding`; Housemate rows say `Settled` where applicable.
- No settlement activity in report month: explicit `No settlement activity recorded for this month`; current outstanding remains separately visible.
- Missing/corrupt required profile or invalid source invariant: fail the complete view with a sanitized application error; do not invent `Unknown` identities when financial reconciliation would become ambiguous.

## Responsive strategy

- Desktop `>=1280px`: three summary cards; two equal/intentional analytics columns; two bottom panels; report summary grid and two-column charts.
- Laptop `1024–1279px`: preserve sidebar and comfortable cards; analytics may use a balanced two-column grid with reduced chart chrome, never horizontally scaled desktop content.
- Tablet `768–1023px`: summary cards wrap naturally (Spent plus two wider cards as space permits); analytics and bottom/report panels reflow based on readable minimum widths rather than squeezing.
- Large mobile `640–767px`: mostly one column; top controls may wrap with avatars on their own aligned row; charts remain full-width.
- Mobile `<640px`: single-column modules; compact but readable summary internals; avatar overflow indicator; Housemate and Expense rows become stacked label/value content; all selector/action controls are approximately 44px; no horizontal page scrolling.
- Chart containers use width `100%`, fixed responsive heights, and `min-width: 0`. Axis tick density changes by breakpoint without deleting daily data points.
- `View All Expenses` and report links remain in normal card flow with dedicated top border/spacing when used as footers.

## Accessibility approach

- Keep one `sr-only` Dashboard `h1`; use visible semantic section headings for module titles. The Monthly Report has a visible `h1`.
- Month trigger has an explicit accessible name including current selection, keyboard operation, visible focus, selected-state announcement, and minimum touch target.
- Member initials are decorative through the existing avatar behavior; an accessible group label/name list conveys the active members once without duplicate announcements.
- Use tabular numerals, readable BDT text, proper `time` values for Expense Dates, and explicit `Gets back` / `Owes` / `Settled` status text.
- Wrap charts in labelled figures, enable Recharts accessibility, and provide a concise visible textual summary plus exact Cash/Card rows. No metric depends only on color, geometry, hover, or tooltip.
- Do not animate charts. Existing global reduced-motion CSS remains in force for all other transitions.
- Ensure logical heading order, semantic lists/tables as appropriate, visible focus, 44px mobile actions, and no overlapping content.
- Run Axe in component/browser coverage and require zero serious or critical findings on Dashboard and Monthly Report desktop/mobile states.

## Proposed implementation phases after approval

### Phase 11A — Pure analytics contract

- Add `CalendarMonth`, exact aggregation functions, immutable result types, and exhaustive unit tests.
- Reuse current balance/recommendation engines; add no UI or persistence changes.

### Phase 11B — Application read projections

- Add Dashboard/report presentation-safe builders and the read-only analytics application service.
- Wire narrow runtime actions and cover active-membership authorization, privacy, current/month separation, and stale-response behavior.

### Phase 11C — Canonical Dashboard

- Add Recharts, shared month/chart components, and the complete responsive Dashboard.
- Verify canonical omissions, Card privacy, selected-month behavior, and current-state invariance.

### Phase 11D — Monthly Report and deep links

- Add `/reports/monthly`, the report hierarchy, month query behavior, Dashboard report link, and Expenses month deep link.
- Verify report semantics, settlement-time language, empty states, and no navigation destination.

### Phase 11E — Full verification and AIDOS closeout

- Run focused and full Vitest, architecture, lint, typecheck, production build, dependency audit, Playwright, responsive/visual, privacy, and Axe checks.
- Update `PROJECT_STATE.md`, `ACTIVE_PLAN.md`, and `AI_LESSONS.md` only with verified implementation results and durable discoveries.
- Stop for Phase 11 review; do not begin Phase 12.

## Proposed files

### New

- `src/application/analytics/calendar-month.ts`
- `src/application/analytics/calendar-month.test.ts`
- `src/application/analytics/monthly-analytics.ts`
- `src/application/analytics/monthly-analytics.test.ts`
- `src/application/analytics/analytics-page.ts`
- `src/application/analytics/analytics-page.test.ts`
- `src/application/analytics/analytics-service.ts`
- `src/presentation/analytics/month-selector.tsx`
- `src/presentation/analytics/daily-spending-chart.tsx`
- `src/presentation/analytics/payment-mix-chart.tsx`
- `src/presentation/dashboard/dashboard-page.client.tsx`
- `src/presentation/dashboard/dashboard-summary.tsx`
- `src/presentation/dashboard/housemate-balances.tsx`
- `src/presentation/dashboard/recent-expenses.tsx`
- `src/presentation/dashboard/dashboard-ui.test.tsx`
- `src/presentation/reports/monthly-report-page.client.tsx`
- `src/presentation/reports/monthly-report-sections.tsx`
- `src/presentation/reports/monthly-report-ui.test.tsx`
- `src/app/(product)/reports/monthly/page.tsx`
- `tests/e2e/dashboard.spec.ts`
- `tests/e2e/monthly-report.spec.ts`

### Modified

- `package.json` / `package-lock.json` — add pinned Recharts only.
- `src/app/(product)/dashboard/page.tsx` — replace placeholder with client boundary.
- `src/app/(product)/expenses/page.tsx` and `src/presentation/expenses/expenses-page.client.tsx` — accept a valid initial `month` query for `View All Expenses`.
- `src/application/services/application-services.ts` and/or `src/application/index.ts` — compose/export the focused analytics service without moving algorithms into the existing large service file.
- `src/app/_providers/local-application-runtime.client.tsx` — expose narrow analytics read actions.
- `src/presentation/runtime/application-runtime-context.tsx` — add presentation-safe analytics actions only.
- `src/presentation/runtime/household-access-gate.client.tsx` — protect `/reports`.
- `src/presentation/components/chart-card.tsx` / `metric-card.tsx` only if the canonical action/figure semantics need a small reusable extension.
- `src/presentation/index.ts` only if the established barrel remains useful.
- `docs/ai/PROJECT_RULES.md`, `PROJECT_STATE.md`, `REQUIREMENTS.md`, `work/ACTIVE_PLAN.md`, and `AI_LESSONS.md` as required by approved implementation decisions and verified results.

Exact file consolidation is allowed when it reduces fragmentation, but dependency direction, pure analytics isolation, view safety, and test coverage may not be weakened.

## Comprehensive test matrix

### Pure unit tests

- `CalendarMonth`: valid/invalid values, current local default injection, previous month, January/December boundary, stable formatting.
- Gregorian day counts: common February, leap-year February, century 1900, leap century 2000, 30-day and 31-day months.
- Monthly filtering uses Expense Date, not `createdAt`; excludes soft-deleted Expenses; includes former-member historical Expenses.
- Monthly sum/count: zero, one, multiple, Cash/Card, same-day, month boundary, safe-integer boundary/overflow rejection.
- Daily series: exact 28/29/30/31 length, ascending day 1 to final day, zero-filled gaps, multiple Expenses per day, no UTC shifting.
- Payment Mix: Cash-only, Card-only, mixed, exact basis-point sum, fractional remainder/tie, zero-spending behavior, `cash + card = spent` invariant.
- Member Paid/Share: different payer and participants, excluded payer, zero-poisha allocation, multiple split modes, former member, exact reconciliation totals.
- Recent Expenses: selected month, top five, Expense Date/createdAt/ID deterministic ties.
- Largest Expenses: amount-desc primary ordering and all deterministic tie-breakers.
- Month comparison: increase, decrease, exact equality, prior month across year boundary, previous zero/current zero, previous zero/current positive, signed basis-point rounding.
- Settlement activity: created/resolved buckets, earlier-created/later-confirmed, Pending, terminal non-financial states, viewer-local timezone boundary callback, no historical balance inference.
- Current metrics: no selected-month filter, confirmed-only settlement effects, recommendation edge count, active Pending count, current-user net Outstanding semantics.
- Housemate ordering: current viewer first, state priority, absolute magnitude, duplicate display names, user-ID tie, active-only display with retained former ledger entries.
- Projection privacy: generic Card only; no private snapshot/reference/name/type/color/ID; no receipts/audits/repository objects.
- Authorization: active member required, wrong Household denied, former member denied, deleted Household denied.

### Application/integration tests

- One analytics call loads source records and produces mutually consistent Spent, chart, Payment Mix, contributions, and report totals.
- Dashboard current-state modules equal existing balance/recommendation results for the same snapshot.
- Expense create/edit/delete source changes reconstruct all affected monthly data without persisted aggregates.
- Settlement confirmation changes current Outstanding/Health/Balances but never selected-month Spent/Trend/Mix/Recent data.
- Membership changes refresh avatars/active balance rows while retained financial history remains included.
- Identity switch changes `You`, current Outstanding, and viewer-first ordering without leaking the prior viewer's view.
- Out-of-order month/identity requests cannot replace a newer view.
- Existing V1/V2/V3 record reconstruction remains compatible; no schema migration or write occurs.

### Component tests

- Dashboard has no visible Dashboard/Overview heading, subtitle, Household hero, Add Expense CTA, or generic sections label; `sr-only` page heading remains.
- Top row order/alignment is Month selector then member avatars; icons are decorative/aligned and names are accessible.
- Month selector keyboard open/select/close/focus behavior and invalid report query fallback.
- Month changes update Spent, Trend, Mix, and Recent while Outstanding, Health, and Housemate values remain invariant for unchanged source records.
- Outstanding is one card with two labelled sub-values, never two top-level cards.
- Settlement Health shows counts/text only and handles `0/1/many` grammar.
- Daily chart receives every day and exposes textual summary; zero month has full zero data and an explicit empty message.
- Payment Mix shows aligned Cash/Card icons, exact totals/proportions, no color-only information, and zero behavior.
- Housemate rows show Gets back/Owes/Settled and signed/tabular amounts in deterministic order.
- Recent rows show Expense Date, payer, generic payment method, amount, correct link, and non-overlapping footer action.
- Report shows every required module; Paid and Share remain separate; largest-expense order; month comparison zero-baseline copy; Settlement Summary current-position disclaimer.
- Initial loading, month-switch loading, retryable error, no Expenses, no settlement activity, and fully settled states.
- Card privacy assertions inspect rendered DOM and serialized props for every viewer shape.
- Desktop/tablet/mobile class behavior, long names, large amounts, and avatar overflow.

### Playwright/browser tests

- Seeded Dashboard canonical layout, exact omissions, selected current local month, source-derived values, and report link.
- Change to a 28/29/30/31-day month and verify first/final day plus zero-day representation.
- Create, edit date/amount/payment, and delete an Expense; navigate back and verify all relevant Dashboard/report values reconstruct.
- Confirm a Settlement and verify only current-state modules/current-outstanding report note change.
- Switch Raiyan/John/Sarah identities and verify Outstanding language, viewer-first ordering, `You`, avatars, and Card privacy.
- Accept/remove/leave/transfer where seeded test setup permits, then verify active avatars/balance rows and route revocation.
- Report direct URL, invalid month fallback, selector URL update, browser refresh, Back to Dashboard, and Dashboard-selected report month.
- `View All Expenses` opens the existing page with the selected month filter.
- Other users see only `Card` in Dashboard/report rows and DOM; private Card metadata never appears.
- Keyboard-only selector, report/expense links, chart focus behavior, and visible focus.
- Desktop, tablet, large-mobile, and narrow-mobile screenshots/gut checks; no horizontal overflow; charts use full width; footer links never overlap.
- `prefers-reduced-motion: reduce` has no chart animation.
- Axe on populated/empty/error Dashboard and Monthly Report at desktop/mobile: zero serious or critical findings.

### Full regression and quality gates

- Focused analytics/application/component suites.
- Full `npm test`.
- `npm run test:architecture`.
- `npm run lint`.
- `npm run typecheck`.
- `npm run build` with `/dashboard` and `/reports/monthly` route evidence.
- Full Playwright Chromium suite.
- `npm audit` with zero newly introduced vulnerabilities and confirmation that Recharts adds no project cost.
- `git diff --check` plus manual source/privacy audits for no persistence import in presentation, no aggregate storage, no private Card metadata, no category/budget/export/Appwrite scope, and no Monthly Report navigation item.

## Risks and proposed resolutions requiring plan approval

1. **Settlement Health meaning.** `Pending` is every active Household Pending record. `Outstanding` counts only current recommendation edges whose unordered pair has no active Pending claim, preventing the same unresolved pair from appearing in both counts even when its Pending claim is stale.
2. **Settlement calendar timezone.** Expense analytics are unambiguous date-only values. Settlement events are instants and the data model has no Household timezone. The plan uses the viewer's local timezone, matching current timestamp display; different timezones can place an event near midnight into different report months. A future Household-timezone model is out of scope.
3. **Month option set.** The plan lists distinct source-relevant months plus current/selected month rather than generating every empty month across an unbounded date span. Users can still reach every month containing relevant source activity and the current empty month.
4. **Payment Mix geometry.** The written canonical requirements do not name the chart shape. The plan uses the common compact two-segment donut with authoritative Cash/Card text rows; approval freezes this as the non-redesign interpretation.
5. **Percentage display.** Spending remains exact poisha. Payment proportions and month-change percentages are display-only integer basis points with deterministic rounding; they are never fed back into finance calculations.
6. **Read consistency.** Phase 11 is read-only and no live cross-tab sync is approved. A single in-memory snapshot per request plus stale-response suppression is proportionate for the local MVP; no new multi-store analytics transaction or materialized view is introduced.
7. **Recharts bundle/dependency surface.** Recharts adds transitive dependencies and client JavaScript. Limit imports to two narrow chart modules, verify tree/build behavior and audit, and do not add a second chart library.

The user approved all seven resolutions with the revised Pending-pair-aware Settlement Health rule above.

## Recommended model and reasoning level

Use **GPT-5.6 Sol (`gpt-5.6-sol`) with high reasoning** for Phase 11 implementation. The work spans exact financial aggregation, date/time boundaries, privacy-safe projections, Next.js Client/Server boundaries, Recharts, accessibility, and broad regression testing. High reasoning is warranted; `xhigh` is unnecessary unless implementation uncovers a contradictory financial/timezone invariant or a difficult cross-layer regression. Official OpenAI documentation identifies GPT-5.6 Sol as the flagship model for complex reasoning and coding and supports `high` reasoning.

## Approval gate

Phase 11A–11E are implemented and verified. The work remains uncommitted for review, with Phase 1–10 behavior preserved. Phase 12, Appwrite, production authentication, deployment, and every explicit exclusion remain unauthorized.

## Completion evidence — 2026-08-19

- Pure analytics and projections cover exact selected-month spending, every Gregorian day, leap years, amount-based Payment Mix with largest-remainder basis points, signed BigInt month comparison, deterministic Recent/Largest selection, Paid versus Share, former-member history, viewer-local Settlement event buckets, current balances/recommendations, and Pending-pair-aware Settlement Health.
- The canonical Dashboard and `/reports/monthly?month=YYYY-MM` are implemented through narrow runtime actions and presentation-safe immutable views. No repository, IndexedDB schema/store/index, or persisted aggregate changed.
- Full Vitest passed 368 tests across 45 files; lint, TypeScript, architecture guards, and production build passed. The build statically prerendered both Phase 11 routes.
- Full Playwright Chromium passed 43 journeys. New coverage verifies current local default, selected-month filtering, current-state separation, active avatars, exact totals/proportions, privacy, leap-year February, invalid-query fallback, report semantics, Expense/Settlement/identity reconstruction, no overflow, reduced motion, and zero serious/critical Axe findings.
- `npm audit` found zero vulnerabilities; Recharts 3.10.1 is the sole chart dependency and is imported only by the approved client chart boundary. `git diff --check` and manual finance/privacy/date/scope/visual audits passed.
