# Frozen Requirements Register

## Authority and status

This file consolidates the approved product, business, UX, visual, architecture, and quality context supplied on 2026-08-12. It is the repository source of truth for implementation planning. Requirements are frozen: contradictions, security issues, missing financial rules, and behavior changes must be raised before inventing a solution.

Product discovery, business rules, UX architecture, visual direction, design system, wireframes, and canonical desktop UI are complete. Implementation, production backend integration, and deployment have not started.

## Product boundary

House Finance Tracker is a shared household expense tracker with one leader and multiple members. Members record expenses they paid; the system calculates shares, balances, deterministic settlement recommendations, monthly spending, and payment-method analytics. It records external settlement claims but never transfers money.

The local MVP includes simulated email/password auth UI, household creation/joining/membership/leadership, expenses, equal/amount/percentage splits, optional multiple receipt images, private dummy cards, balances and settlement recommendations, receiver-confirmed settlements, dashboard, analytics, monthly reports, responsive UI, tests, visual QA, and an accessibility baseline.

Out of scope: categories, recurring expenses, budgets, multiple currencies, multiple households per user, export, notifications, real banking/cards/payment processing, banking APIs, receipt OCR, and paid third-party services. Currency is BDT only. Initial development and dependencies must add no project cost.

## Architecture and stack

- Next.js App Router + TypeScript; Tailwind CSS + shadcn/ui; Lucide; Recharts; React Hook Form + Zod; Vitest + React Testing Library; Playwright.
- Dependency direction: UI -> application services -> pure domain logic -> repository interfaces -> local implementations. React and Appwrite must not enter domain logic.
- Local/mock users and identity switching support permission and settlement testing. Production auth/backend are deferred.
- Appwrite may be integrated only after the local MVP is stable, through repository implementations; UI must never call it directly.
- Local receipts use private local representations. Future storage must be private and authorization-enforced.

## Accounts and households

- Account identity uses email/password and display name. Eventual flows include register, login/logout, verification, forgot/reset password.
- A user belongs to at most one household. If not a member, they may create one or submit one non-conflicting active join request.
- Household creation requires a name and globally unique nine-digit code stored as a string; leading zeroes are valid. Creator becomes leader.
- Join flow: find by code -> request -> pending -> leader accepts/rejects. Requester may cancel and sees no private household data before acceptance.
- Members may leave only with zero net balance and no pending settlements. Leaders with remaining members must first clear obligations and transfer leadership.
- Leaders may remove members only when the member has zero balance and no pending settlements. Historical participation remains.
- Only the leader may delete a household, after all balances are zero, no settlements are pending, and explicit destructive confirmation.
- Leader powers never override private-card visibility.

## Expenses, payment, cards, and history

- Expense fields: name, positive amount, expense date, payer, Cash/Card payment method, selected participants, split type and values, optional multiple image receipts.
- Payer is exactly the current user creating the expense and is displayed as `You`; it is not selectable. All current members start selected, but any - including payer - may be excluded. At least one participant is required.
- Payment defaults to Cash. Card selection is active only for Card and only from the current user's cards.
- Cards are private user-owned labels with name, Debit/Credit type, and predefined color. Never store card number, expiry, CVV, network/bank credentials, or tokens.
- Only a card owner may see its name, type, and color. Other viewers - including leaders - see only `Card`. Private metadata must not leak through responses, state, forms, HTML, logs, or debugging data.
- Household members can view household expenses and authorized receipts. Only the expense creator or leader may edit or soft-delete; deleted expenses no longer affect balances, dashboards, analytics, or reports.
- Financial edits trigger recalculation but never rewrite confirmed settlements. Preserve audit events for meaningful expense and settlement lifecycle changes.
- Historical records involving former members must never be altered in a way that creates new debt for a departed member.

## Exact money and split invariants

- Store and calculate BDT as integer poisha. JavaScript floating-point values are prohibited for money calculations.
- Every expense has exactly one payer, at least one participant, and amount greater than zero.
- Equal splits allocate every poisha with deterministic remainder handling.
- Amount splits save only when allocated poisha exactly equals the expense total; show live allocated/remaining feedback.
- Percentage splits total exactly 100%, show resulting money, and allocate every poisha deterministically.
- For every household, member net balances sum to zero and total creditor value equals total debtor value.

## Balances and settlements

- Conceptual balance: amount paid - assigned share + confirmed settlement effects. Code must define one consistent sign convention.
- Recommendations deterministically resolve current balances with simple `You owe` / `You are owed` language.
- MVP supports full recommended settlements only. `Settle Up` clearly says no money is transferred and asks the sender to confirm external payment.
- Lifecycle: Pending -> Confirmed, Rejected, or Cancelled. Receiver alone confirms/rejects; sender may cancel while pending.
- Pending, rejected, and cancelled settlements never affect balances. Only confirmed settlements do, and confirmed records are immutable.
- Prevent duplicate active settlement attempts for the same obligation.

## Navigation and screens

- Desktop sidebar: Dashboard, Expenses, Settlements, Cards, Household; bottom profile, role, logout. Badges represent current-user settlement actions and leader join requests. Monthly Reports are reached from Dashboard.
- Mobile bottom navigation: Dashboard, Expenses, Add, Settlements, More; More contains Cards, Household, Profile.
- Dashboard header is month selector plus current-member avatars, without a large generic title/CTA block. Modules: selected month, Spent, one combined Outstanding card, Settlement Health, daily bar-chart Spending Trend, Cash/Card Payment Mix, current Housemate Balances, Recent Expenses.
- Month-dependent spending data uses expense date and selected month. Outstanding, settlement health, and housemate balances remain current-state data.
- Expenses page: title, Add Expense, name search, month/payer/payment filters, expense-date sorting (newest first or oldest first), and clickable rows/cards. No category filter.
- Add Expense is one structured page: details, payment, receipts, participants, split method, and live summary. Desktop may use adjacent/sticky summary; mobile is one scrolling form.
- Expense Details shows approved financial/detail/history sections and only owner-visible card metadata.
- Monthly Report includes selected month, total/count, largest expenses, member paid/share totals, Cash/Card, settlement summary, month-over-month change, and spending trend, based on expense date.
- Analytics are limited to spending trend, payment mix, member contributions/shares, expense count, largest expenses, and month-over-month spending.

## Visual and interaction system

- Direction: Soft Premium Finance - light, airy, minimal, trustworthy, spacious, rounded, subtly elevated, and financially clear. Avoid generic purple SaaS styling, heavy gradients/glass/shadows, visual noise, dense accounting treatment, and excessive animation.
- Inter typography: page 32/40/600; H1 28/36/600; H2 24/32/600; H3 20/28/600; body-large 16/24; body 14/22; label 13/18/500; caption 12/16. Financial values use tabular numerals where useful.
- Foundation colors: background `#F5F6F8`, surfaces `#FFFFFF`/`#F9FAFB`, text `#171717`/`#525866`/`#8A8F98`, disabled `#B6BAC2`, borders `#E7E9EE`/`#D9DCE3`; accent `#DFFF63`, hover `#D4F24F`, soft `#F3FFC7`; primary CTA `#171717` with white text.
- Semantic palettes: success `#15803D`/`#DCFCE7`; danger `#DC2626`/`#FEE2E2`; warning `#B7791F`/`#FEF3C7`; info `#2563EB`/`#DBEAFE`. Always include text - not color alone.
- Use approved spacing (4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80), radii (8, 12, 16, 20, 24, pill), and coherent card/surface families. Shadows remain subtle: small `0 1px 2px rgba(0,0,0,.04)`, card `0 4px 16px rgba(0,0,0,.04)`, modal `0 16px 40px rgba(0,0,0,.08)`.
- Desktop sidebar is approximately 220-240px; main max width approximately 1440px; page padding scales 32/24/20/16px.
- Breakpoints: under 640 mobile; 640-767 large mobile; 768-1023 tablet; 1024-1279 laptop; 1280+ desktop. Responsive layouts change behavior, not just scale.
- Mobile uses mostly one column, expense cards instead of tables, full-width charts, reachable settlement actions, and sheet/full-screen patterns for large dialogs. Touch targets are approximately 44px minimum.
- Buttons, inputs, icons, empty/loading/error/success/permission states follow the approved patterns. Preserve form data on error and prevent duplicate submissions.
- Accessibility baseline: WCAG-AA-oriented contrast, visible focus, semantics/labels, keyboard operation, accessible dialogs/errors, reduced motion, large touch targets, no color-only meaning, and textual chart summaries.
- Motion is restrained (150/200/300ms, generally ease-out); do not excessively animate financial values.

## Canonical design rule

Approved desktop references are Dashboard, Expenses, Add Expense, and Expense Details. All other and responsive screens extend their components and visual language. Missing spacing, hierarchy, responsiveness, states, or consistency are implementation bugs; major redesign requires approval.

## Verification priorities

Unit-test money parsing/formatting, every split mode and rounding case, balances, settlement scenarios/status effects/duplicate protection, membership gates, edit permissions, and card privacy. Use component tests for forms and states, and Playwright for critical multi-user household, expense, settlement, permission, responsive, and accessibility flows.

## Frozen implementation clarifications

Approved on 2026-08-12:

1. Equal-split remainder poisha follows stable participant-ID order.
2. Percentages use integer basis points; `100% = 10,000`. Monetary conversion uses largest remainder with participant-ID tie-breaking.
3. Settlement recommendations use deterministic largest-debtor/largest-creditor greedy matching with stable member-ID ties. The product does not claim a proven absolute minimum transfer count.
4. Pending settlements snapshot sender, receiver, exact amount, creation timestamp, and status. They never affect balances or change amount automatically. Confirmation applies the original exact amount even when current recommendations changed; stale/current-balance warnings are required.
5. A leader editing another user's Card expense sees only `Card` and may preserve its opaque reference or change Card to Cash, which clears the reference. The leader cannot select/change the private card or change Cash to Card. Private metadata must never enter leader-visible data.
6. Financial changes involving former members are frozen whenever they could alter the former member's settled position or create debt. Only provably non-financial changes are allowed; ambiguity is escalated.
7. Referenced cards are archived, remain owner-private historical references, and cannot be selected for new expenses. Never-referenced cards may be permanently deleted.
8. Local structured records and receipt blobs use IndexedDB behind replaceable repository interfaces; domain/application code cannot depend directly on IndexedDB.
9. Expense dates are date-only `YYYY-MM-DD` values with no UTC shifting. Audit/system timestamps are ISO instants and remain distinct from expense dates.
10. Local authentication is simulated with development identities Raiyan, John, Sarah, and Alex. Identity switching is development-only. Secure sessions, real email/password auth, verification, and recovery are deferred to Appwrite.
