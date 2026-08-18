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
- A sole remaining leader cannot leave and create a leaderless household; their explicit exit path is household deletion after all deletion gates pass.
- Leadership transfer changes authority only and does not require either member to have a zero balance. The current leader must transfer to another active member, leaving exactly one active leader.
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
- A selected participant may receive a zero-poisha share when exact allocation requires it. Every selected participant remains present exactly once in the completed allocation.
- Domain money conversion may produce deterministic canonical ungrouped decimal text such as `123456.78`. Currency symbols, digit grouping, and localization are presentation concerns and never participate in financial arithmetic.
- For every household, member net balances sum to zero and total creditor value equals total debtor value.

## Balances and settlements

- Conceptual balance: amount paid - assigned share + confirmed settlement effects. Code must define one consistent sign convention.
- Recommendations deterministically resolve current balances with simple `You owe` / `You are owed` language.
- MVP supports full recommended settlements only. `Settle Up` clearly says no money is transferred and asks the sender to confirm external payment.
- Lifecycle: Pending -> Confirmed, Rejected, or Cancelled. Receiver alone confirms/rejects; sender may cancel while pending.
- Pending, rejected, and cancelled settlements never affect balances. Only confirmed settlements do, and confirmed records are immutable.
- New settlements may be created only from an exact current full recommendation; arbitrary parties and amounts are prohibited.
- For a household, at most one Pending settlement may exist for an unordered member pair, regardless of direction or amount. Terminal history does not block later creation.

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
11. Domain money conversion is deterministic and unlocalized. Presentation may later render approved BDT symbols and grouping, but locale formatting never participates in parsing, allocation, or other financial arithmetic.
12. Exact split allocation may assign zero poisha to selected participants. Zero-share participants remain explicit members of the completed allocation and are never silently removed.
13. Pending-settlement duplicate protection is household-scoped and uses the unordered member pair. While one claim is Pending, no same-direction or reverse-direction Pending claim may be created for that pair.
14. A sole remaining leader cannot leave. They must explicitly delete the household after all balances are zero and no settlement is Pending; a leave attempt never auto-deletes it.
15. Leadership transfer requires the current leader and another active member and must preserve exactly one active leader. Balances do not gate the authority transfer; normal leave gates still apply afterward.
16. Settlement creation requires an exact current full deterministic recommendation. Once created, the Pending record snapshots its original parties and amount and is not synchronized with later recommendations.

## Frozen Phase 4 persistence clarifications

Approved on 2026-08-13:

- Local structured persistence uses the small `idb` wrapper and tests use `fake-indexeddb`; no ORM, generic repository framework, SQL abstraction, synchronization layer, or speculative query system is permitted.
- Application-owned ports cover profiles, households, memberships, join requests, expenses, settlements, cards, receipts, and append-only audit events, using only operations required by frozen product flows.
- IndexedDB conditional uniqueness uses optional derived keys that exist only while a record is active or Pending. These keys cover one active membership per user, one Pending join request per user, and one household-scoped unordered Pending settlement pair. Pair encoding uses stable user-ID order and a collision-safe compound serialization.
- Atomic persistence is expressed through named application operations sharing one IndexedDB transaction, not a general enterprise unit-of-work framework.
- Persisted records are untrusted. Reads validate record shape, reconstruct branded values, and re-run domain invariants. Malformed-data errors identify only a store/key and never serialize private records.
- IndexedDB schema version and record version are separate and both start at `1`. Migrations are monotonic, transactional, and cannot silently discard or rewrite financial history.
- Card-paid expense history stores a separate owner-private snapshot containing card ID, name, Debit/Credit type, and color. Card edits, archive, or deletion never rewrite/remove that snapshot. Non-owners receive only the Card payment method.
- Referenced cards are archived; unreferenced cards may be physically deleted. Archived cards cannot be selected for new expenses.
- Receipts accept actual JPEG, PNG, or WebP Blob content from 1 byte through 10 MiB. Metadata size must match Blob size and signature validation must agree with MIME type. No count cap, base64, OCR, thumbnail, or transformed image is introduced. Deletion retains a metadata tombstone and audit event while removing the Blob.
- Local email uniqueness uses trimmed lowercase `emailKey`; trimmed original casing is retained as `displayEmail`. This is local identity behavior, not production authentication semantics.
- Development identity uses one replaceable current-session port. Deterministic identities are Raiyan (leader), John and Sarah (active members), and Alex (Pending requester). Identity switching remains development-only.
- Reset/reseed closes owned connections, deletes the exact injected database name, recreates schema, and restores deterministic data/current identity. A blocked reset is a typed error and reset logic is never product household deletion.
- Audit events are append-only summaries of actor, time, aggregate, action, and changed fields. They exclude private card details, receipt bytes, auth secrets, and unnecessary serialized financial objects.
- Confirmed settlements are immutable in application services and persistence adapters. Balances, recommendations, dashboard totals, outstanding totals, and analytics aggregates are never persisted.
- No live cross-tab synchronization is required. Only version-change, blocked-upgrade, and reset coordination are supported.
- IndexedDB and the development-session implementation remain behind a client-only Next.js boundary. Server Components cannot import browser infrastructure, and local persistence does not make the whole application client-rendered.

## Frozen Phase 7 percentage-source persistence requirement

Approved on 2026-08-18 as a requirement change:

- Every newly created or financially edited percentage expense persists both the original validated participant basis-point entries and the canonical final poisha allocations in the same atomic transaction.
- Percentage entries contain exactly the selected participants once each, use integer basis points, total exactly 10,000, reconstruct through the existing branded/domain validation, and must reproduce the persisted allocations exactly when passed with the persisted amount through the canonical percentage allocator. Any disagreement is corrupt persisted financial data.
- Percentage source entries exist only for the current state of percentage expenses. Equal expenses remain reproducible from amount and participants; Amount allocations remain the exact monetary source. Changing Percentage to Equal or Amount removes percentage entries from the current expense state without deleting safe audit history.
- Existing percentage expenses without original basis points are retained as explicit legacy percentage records. Their persisted poisha allocations remain authoritative for their financial effect, but the application never infers or invents percentages from those allocations.
- Authorized viewers may view legacy percentage expenses. Financial edits and any workflow requiring original percentage reconstruction are blocked. Existing non-financial Expense Name and receipt-lifecycle edits remain permitted only when the approved financial fingerprint is identical.
- The expense record version and IndexedDB schema version advance through the existing monotonic transactional migration architecture. Migration changes only the record envelope/version for legacy data; it never fabricates basis points, rewrites final allocations, drops historical expenses, or partially rewrites financial history.
- The accepted seed contains no percentage expense and its product behavior remains unchanged.

The durable data-model rule is: persist user-entered financial source data together with its derived financial result whenever the source cannot be uniquely reconstructed, and validate that both representations agree.

## Frozen Phase 5 shell clarifications

Approved on 2026-08-13:

- Navigation uses the mobile/tablet bottom bar below `1024px` and the full desktop sidebar from `1024px`; Phase 5 has no collapsed tablet sidebar. Bottom navigation accounts for safe-area insets and never covers content.
- `/` redirects to `/dashboard`. Sparse placeholders for Dashboard, Expenses, Add Expense, Settlements, Cards, Household, and Profile validate routing and shell behavior without implementing those features.
- Branding is an understated Lucide `House` icon with the `House Finance Tracker` text wordmark. Missing profile images use deterministic initials; no generated or external avatars are permitted.
- The visible Log Out action remains intentionally unavailable until real authentication exists. It cannot mutate the development session or mimic authentication, and its accessible explanation cannot rely only on hover.
- Sonner supplies restrained toast infrastructure. `ChartCard` remains chart-library-neutral until real analytics require Recharts.
- Development identity switching is clearly labelled development tooling, remains separate from product navigation/profile/authentication, and reaches the current-session abstraction without teaching product components about identity selection.
- React context exposes only presentation-facing application services and session/view state. Repositories, IndexedDB objects, adapters, and broad infrastructure runtimes remain private to the client composition root.
- Runtime composition handles initialization, Strict Mode/HMR, abandoned work, retry, unmount/pagehide, and connection closure. Retry never deletes or resets local data.
- Phase 5 native-browser verification uses the actual client runtime to prove native database opening, seed reads, identity switching, close/reopen persistence, and application-state reconstruction. It does not duplicate repository contracts already covered through `fake-indexeddb`.
- Phase 5 implements the frozen light design tokens, accessibility and reduced-motion foundation, responsive shell, and only shared components that add concrete visual or behavioral consistency. No dark theme or feature-screen implementation is introduced.

## Frozen Phase 6 household-onboarding clarifications

Approved on 2026-08-13:

- Local development identities represent authenticated users without login, registration, passwords, cookies, verification, recovery, fake logout, or production-security claims. The DEV identity selector remains separate tooling.
- Household access states are presentation-safe `no-household`, `pending-request`, `active-member`, and `active-leader` states beneath runtime loading/error. Mutations always persist first and then reconstruct authoritative state through one invalidation path.
- Active membership is required only for Dashboard, Expenses, Add Expense, and Settlements. Household and Profile remain independent; Cards acquire no new household access rule during Phase 6.
- House names are trimmed and non-empty with no invented maximum. Household codes are exact nine-character ASCII digit strings, preserve leading zeroes, remain reserved by historical/deleted records, and are finally protected by IndexedDB uniqueness.
- Generated codes use injected randomness, validate every candidate, check local uniqueness for at most 32 attempts, and fail with a typed retryable error rather than a predictable fallback. Browser generation uses cryptographically secure randomness.
- Before acceptance, household lookup and Pending state expose only household name, code, and opaque ID. They never expose members, leader identity, expenses, balances, settlements, receipts, cards, or financial history.
- A Pending requester must explicitly cancel before creating a household. Only Pending requests block another request; Accepted, Rejected, and Cancelled records remain retained terminal history.
- Leader acceptance and rejection require confirmation and application authorization. Acceptance atomically rechecks Pending status and active membership, transitions the request, creates exactly one active membership, and appends audit history; any failure rolls back all writes.
- The Phase 4 seed remains Raiyan as leader, John and Sarah as members, and Alex as a Pending requester. Tests cancel Alex's request when they need the no-household state.

## Frozen Phase 7 expense-and-receipt clarifications

Approved on 2026-08-13:

- Expenses default to the current local calendar month and also support All Months. Search is trimmed, case-insensitive Expense Name substring matching only. Search, Expense Date month, payer, and Cash/Card filters compose with AND before deterministic sorting. Clear Filters restores current month, all payers, all payments, and newest first.
- Newest ordering is Expense Date descending, `createdAt` descending, then ExpenseId ascending. Oldest reverses the first two keys and retains ExpenseId ascending. Repository/input ordering is never a display tie-break.
- Creator and payer both equal the current actor at creation and are immutable afterward. Edit never offers a payer selector and application services must reject identity changes.
- New expenses select all active members by default but allow any exclusion, including payer; at least one participant remains required. Historical/former participants are retained and never silently removed.
- Persisted Equal, Amount, and Percentage allocations come only from the existing Phase 2 engines. Amount preview shows Allocated plus Remaining/Over by and requires an exact sum. Percentage preview may show clearly provisional amounts only while all entries are valid and total below 10,000 basis points; invalid, unparsable, or over-100% drafts show validation instead. Only the exact 10,000-basis-point largest-remainder allocation is persisted. Zero-share participants remain explicit.
- Cash is the create default and stores no current Card association. Card creation selection is limited to the actor's active/non-archived private cards. No-card UI remains usable with Cash and adds no Card CRUD or unfinished-management redirect.
- Owners may change Cash/Card and select another owned active Card; an archived historical association may be preserved but cannot be newly selected. A non-owner leader may preserve an opaque Card association or confirm Card to Cash, but cannot change Cash to Card or Card to another Card and receives no private reference/name/type/color.
- Current details follow current Payment Method. Cash exposes no current Card association. Any retained older private Card/audit facts stay owner-private and are not deleted or promoted into current state.
- Receipts remain uncapped by business rule but use conservative incremental resource handling, object URLs with prompt revocation, no base64, no unnecessary duplicate loading, and form-draft preservation on quota/persistence failure. A technical count cap requires a separate proposal.
- Edit stages receipt additions and removals until Save or Cancel. Save atomically commits expense changes, receipt additions, receipt tombstones/Blob removals, and audit; Cancel persists nothing. Expense soft deletion never deletes or tombstones its remaining receipts.
- A known soft-deleted expense remains directly accessible to authorized household viewers as clearly Deleted, read-only history. It stays out of normal lists and all derived financial calculations.
- Details and editor models are privacy-safe application projections, never broad records later hidden in React. Activity contains only safe action, actor, timestamp, and changed-field names, never private Card metadata, receipt bytes, or serialized expense objects.
- If an expense involves a former member, amount, payer, participants, shares, Expense Date, Payment Method, and deleted state are frozen. Only policy-proven non-financial name/receipt changes are allowed, with application/domain enforcement repeated at Save.
- Expense changes never modify confirmed settlements. Current balances are re-derived from source history and legitimate reverse balances are accepted.
- Paid By options retain relevant former historical payers. Expense dates remain `YYYY-MM-DD` and are never UTC-round-tripped in a way that shifts the day.
- Filter state may remain local presentation state; URL query persistence is not required. Canonical Expenses, Add Expense, and Expense Details references remain implementation authority across responsive layouts.
