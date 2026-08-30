# Frozen Requirements Register

## Authority and status

This file consolidates the approved product, business, UX, visual, architecture, and quality context supplied on 2026-08-12. It is the repository source of truth for implementation planning. Requirements are frozen: contradictions, security issues, missing financial rules, and behavior changes must be raised before inventing a solution.

Product discovery, business rules, UX architecture, visual direction, design system, wireframes, and canonical desktop UI are complete. The local/provider-independent application is complete through the approved pre-production hardening checkpoint. Phase 13A Appwrite foundation/schema work is complete; Phase 13B authentication/session work is implemented but remains uncommitted and separately gated from Phase 13C.

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

- Production identity uses Appwrite Auth email/password, with Appwrite Auth email authoritative and no independently writable Profile email.
- Production supports an operational set of exactly three approved account emails while retaining the existing fail-closed configuration parser boundary of at most four. `HFT_ALLOWED_ACCOUNT_EMAILS` is the sole deployed server-side approved-account configuration: missing, empty, malformed, or more than four normalized unique emails fails closed; normalized comparison is trimmed and lowercase, and the list is never returned, logged, rendered, or included in browser code.
- **REQUIREMENT CHANGE approved on 2026-08-30:** approved users may create their own email/password Appwrite account through canonical `/signup`; `/register` redirects to `/signup`. Signup contains only Email, Password, and Confirm Password, creates no verification flow, and produces an immediately usable session. Production email editing remains unsupported, `emailVerified` never gates product access, and trusted actor restoration re-checks the approved allowlist so a direct non-approved Appwrite account receives no product access.
- Signup executes through the trusted same-origin server boundary using the ordinary Appwrite Account API without provisioning/bootstrap credentials or the admin Users API. It applies a five-attempt/day/IP HMAC-opaque throttle, creates the Auth account, attempts the existing deterministic `ensureProfile`, creates an email/password session, and sets the existing hardened `hft_session` cookie. Auth/Profile creation is intentionally repairable rather than falsely atomic: later trusted login/restore idempotently repairs a missing Profile.
- A non-approved normalized email returns `Email not allowed. Contact admin.` before any Appwrite account is created through the product. An existing approved account is never recreated, deleted, replaced, reset, or detached from its Profile/history; Signup returns a presentation-safe Sign in/reset-password result.
- Authenticated production Profile supports current-password-protected password change through the session `Account.updatePassword` API only. The request derives the actor/session exclusively from `hft_session`; on success the local cookie is cleared and Login presents `Password updated successfully. Sign in with your new password.` Password recovery remains available but is no longer the only password-change path.
- The temporary `APPWRITE_PROVISIONING_API_KEY` tooling remains isolated historical/operator infrastructure and is not used by Signup or password update. No real account creation, deletion, password mutation, provider user-limit change, deployment, release, or tag is authorized by this requirement change without the live-acceptance approvals in the v1.1 plan.
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
- Financial edits to Expenses outside settled-history lock boundaries trigger source-derived recalculation. An Expense that existed when any same-Household Settlement became Confirmed is financially immutable; confirmed Settlements themselves remain immutable. Preserve audit events for meaningful expense and settlement lifecycle changes.
- Historical records involving former members must never be altered in a way that creates new debt for a departed member.

## Confirmed Settlement financial lock

**REQUIREMENT CHANGE approved on 2026-08-22.** This corrective rule intentionally supersedes the earlier behavior that permitted an old Expense financial edit to recalculate current balances after a Household Settlement was Confirmed.

- The authoritative derived boundary is the latest `resolvedAt` among Confirmed Settlements in the same Household. An Expense is financially locked exactly when that boundary exists and `expense.createdAt <= latestConfirmedSettlementAt`. Pending, Rejected, and Cancelled Settlements do not contribute. Expense Date is user-entered date-only business data and never determines the boundary; a backdated Expense created after a confirmation remains editable until a later confirmation reaches its `createdAt`.
- The boundary is derived from current Expense and Settlement history and is never persisted as a lock flag or Household aggregate. Collection reads may derive the latest boundary once per Household. Authoritative Edit/Delete transactions reread the current Expense, memberships/permissions, current Settlement state, and private Card association where relevant immediately before commit.
- A locked Expense cannot change amount, Expense Date, payer, participants, allocation shares, split method, percentage basis points, Payment Method, opaque private Card association identity, or deleted state. Creator and House Leader are equally unable to bypass this historical-integrity rule. Confirming a Settlement locks only Expenses that already existed; later Expenses remain financially editable until a later confirmation.
- Expense Name and receipt lifecycle remain outside the canonical financial fingerprint and may be changed where existing authorization permits and the complete financial fingerprint is identical. The Card-association comparison uses only an opaque internal identity and never exposes another user's Card ID, name, type, color, or historical private snapshot through presentation or leader-facing projections.
- `expenseId`, `householdId`, `creatorId`, and `createdAt` are immutable replacement identity/history. `createdAt` is a financial-history security boundary and must not be trusted from a proposed replacement.
- Confirmed-settlement, former-member, and legacy-percentage reasons remain independently represented and compose without weakening their existing typed errors. Confirmed-settlement financial rejection uses `EXPENSE_FINANCIAL_HISTORY_LOCKED`; former-member and legacy-percentage causes retain `FORMER_MEMBER_FINANCIAL_HISTORY_FROZEN` and `LEGACY_PERCENTAGE_INPUT_UNAVAILABLE`. Raw codes and private implementation details are never user-facing.
- Edit presentation exposes one coherent `Financial details are locked` state, disables only financial controls, and leaves authorized Name/receipt controls usable. Delete is not actionable and explains that the Expense is settled financial history. UI state is advisory: a stale Save/Delete after a concurrent confirmation commits no Expense, receipt, private Card snapshot, audit, or Settlement write, reloads authoritative state, and discards stale financial draft values while safely retaining Name/receipt draft work where possible.
- Existing persisted Expense state becomes the historical state going forward. No reconstruction, rollback, guessed correction, adjustment Expense, correction transaction, Settlement reopening/reversal, or balance forgiveness is authorized. No IndexedDB migration is required.

## Receipt content retention

**REQUIREMENT CHANGE approved on 2026-08-22.** House Finance Tracker retains receipt binary content for the current calendar month and the previous two calendar months, calculated from `receipt.createdAt` using the fixed `Asia/Dhaka` timezone. The cutoff is the start of the earliest retained calendar month in that timezone: content created exactly at the cutoff is retained and content created before it is eligible for permanent removal. This is calendar-month retention, never an approximate day count. Expense Date remains the separate timezone-independent `YYYY-MM-DD` business value and never participates in receipt retention.

- Receipt metadata uses the canonical content states `available`, `user-deleted`, and `retention-expired`. `available` has no removal timestamp or user; `user-deleted` requires `contentRemovedAt` and `contentRemovedByUserId`; `retention-expired` requires `contentRemovedAt` and has no deleting user. Only `available -> user-deleted` and `available -> retention-expired` are valid. Terminal states never transition or restore.
- User removal immediately removes binary content, retains metadata, records `user-deleted`, and preserves the existing user-attributed audit behavior. Automatic expiration records `retention-expired` without fabricating a user actor. A known terminal receipt is never fetched or converted to a Blob URL.
- Receipt filename, MIME type, original size, creator, Household, Expense, and creation timestamp remain lightweight history after content removal. Historical UI distinguishes retention expiration from user removal and explains the rolling three-calendar-month policy without a warning banner.
- Receipt expiration never deletes or mutates Expenses, allocations, percentage basis points, Settlements, memberships, Households, Join Requests, profiles, Cards, private historical Card snapshots, or required financial/audit history. It has no effect on balances, recommendations, Dashboard, Monthly Reports, member paid/share totals, former-member integrity, or Household membership/deletion gates. No financial checkpoint or compaction system is required.
- Expense soft deletion and Household tombstoning do not immediately remove receipt binaries. Their available receipts continue through the ordinary time-based retention policy; metadata remains preserved.
- Retention policy and orchestration remain provider-independent. The local foundation supplies the model, migration, cutoff policy, privileged application use case, UI states, and tests without a public purge action. Automatic server scheduling and Appwrite Storage deletion remain Phase 13 work.

### Approved House name rename

**REQUIREMENT CHANGE approved on 2026-08-22 by product owner request.** This amendment supersedes the earlier statement that no Household rename UI is added. The active Household view gains a leader-only rename control for the House name. Only the House Name changes: codes, memberships, leadership, balances, expenses, settlements, receipts, Cards, and history are untouched. The submitted name is trimmed and must be non-empty with no invented maximum, matching household creation rules. An unchanged name commits nothing and appends no audit event. Authorization requires the active Leader at commit time inside the authoritative transaction; members and former members receive no rename control and cannot invoke the operation. Every successful rename atomically persists the new name, advances the Household update timestamp, and appends one sanitized `renamed` audit event naming only changed field names. Failure rolls back every write and never auto-retries.

### Approved local bootstrap retention execution

**REQUIREMENT CHANGE approved on 2026-08-22 by product owner request.** This amendment supersedes the earlier statement that local mode ships "without browser-triggered cleanup". The local client runtime now opportunistically executes the privileged retention workflow once per runtime acquisition during bootstrap, using the authoritative injected Clock and the unchanged deterministic cutoff policy. There is still no public purge action, no UI trigger, no user-facing storage controls, and no new deletion scope: only already-expired `available` content transitions through the same idempotent conditional workflow. Sweep failures are surfaced as operational diagnostics in the run summary and logged without blocking startup or mutating any non-eligible record. Phase 13 retains ownership of trusted scheduled execution, server-side Storage deletion, orphan reconciliation, and retry policy.
- An `available` record with unexpectedly missing content is an integrity/content-read failure outside the retention workflow. For an actually eligible candidate, the privileged retention workflow may treat already-missing content as idempotent deletion success and conditionally finalize `available -> retention-expired`.

### Approved Card Designs requirement change

**REQUIREMENT CHANGE approved on 2026-08-22 by product owner request.** Card creation and editing replaces the plain color-swatch picker with six predefined Card designs named Red, Yellow, Black, Blue, Green, and Orange. The form renders each design as a realistic payment-card preview showing the entered Card name, the owner's display name, the Debit/Credit type, and decorative demo number and expiry values that are presentation-only constants: they are never stored, submitted, or included in any application payload, preserving the frozen no-card-numbers rule. My Cards renders each owned Card using its chosen design at full size. Storage remains the existing stable identifier vocabulary, extended additively with the six new design identifiers; all six legacy identifiers stay valid forever so persisted Cards and private historical Expense Card snapshots are read without rewriting them, no IndexedDB schema-version bump occurs, and legacy V1 color migration remains anchored to the original legacy vocabulary rather than the widened one.

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
- Receipts accept actual JPEG, PNG, or WebP Blob content from 1 byte through 10 MiB. Metadata size must match Blob size and signature validation must agree with MIME type. No count cap, base64, OCR, thumbnail, or transformed image is introduced. User deletion retains explicit `user-deleted` metadata and an audit event while removing the Blob; automatic retention uses the distinct `retention-expired` state.
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

- Navigation uses the mobile/tablet bottom bar below `1024px` and the full desktop sidebar from `1024px`; Phase 5 has no collapsed tablet sidebar. The mobile/tablet bottom bar is icon-only with centered controls; visible labels are not rendered, while accessible names and hover titles remain available. Bottom navigation accounts for safe-area insets and never covers content.
- `/` redirects to `/dashboard`. Sparse placeholders for Dashboard, Expenses, Add Expense, Settlements, Cards, Household, and Profile validate routing and shell behavior without implementing those features.
- Branding is an understated Lucide `House` icon with the `House Finance Tracker` text wordmark. Missing profile images use deterministic initials; no generated or external avatars are permitted.
- The visible Log Out action remains intentionally unavailable until real authentication exists. It cannot mutate the development session or mimic authentication, and its accessible explanation cannot rely only on hover.
- Sonner supplies restrained toast infrastructure. `ChartCard` remains chart-library-neutral until real analytics require Recharts.
- Development identity switching is clearly labelled development tooling, remains separate from product navigation/profile/authentication, and reaches the current-session abstraction without teaching product components about identity selection.
- React context exposes only presentation-facing application services and session/view state. Repositories, IndexedDB objects, adapters, and broad infrastructure runtimes remain private to the client composition root.
- Runtime composition handles initialization, Strict Mode/HMR, abandoned work, retry, unmount/pagehide, and connection closure. Retry never deletes or resets local data.
- Phase 5 native-browser verification uses the actual client runtime to prove native database opening, seed reads, identity switching, close/reopen persistence, and application-state reconstruction. It does not duplicate repository contracts already covered through `fake-indexeddb`.
- Phase 5 implements the frozen light design tokens, accessibility and reduced-motion foundation, responsive shell, and only shared components that add concrete visual or behavioral consistency. No dark theme or feature-screen implementation is introduced.

### Approved desktop sidebar collapse correction

Approved on 2026-08-22:

- The desktop sidebar remains available from `1024px` upward and may collapse into a compact icon rail through an accessible control. When collapsed, the control is hidden until the user hovers or focuses the logo, then appears in place over the logo rather than protruding into the content area. Collapse and expansion use a smooth, reduced-motion-aware transition and preserve the current route and navigation actions.
- Collapsing is presentation-only for the current shell session. It does not change permissions, route behavior, product data, or the mobile/tablet bottom navigation below `1024px`.
- Icon-only navigation and account/development controls retain accessible names and hover titles. The collapse control exposes its expanded state and the sidebar it controls.

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
- Edit stages receipt additions and available-content removals until Save or Cancel. Save atomically commits expense changes, receipt additions, `user-deleted` metadata/Blob removals, and audit; Cancel persists nothing. Expense soft deletion itself never deletes or changes its remaining receipts, while the separate retention policy may later expire eligible binary content.
- A known soft-deleted expense remains directly accessible to authorized household viewers as clearly Deleted, read-only history. It stays out of normal lists and all derived financial calculations.
- Details and editor models are privacy-safe application projections, never broad records later hidden in React. Activity contains only safe action, actor, timestamp, and changed-field names, never private Card metadata, receipt bytes, or serialized expense objects.
- If an expense involves a former member, amount, payer, participants, shares, Expense Date, Payment Method, and deleted state are frozen. Only policy-proven non-financial name/receipt changes are allowed, with application/domain enforcement repeated at Save.
- Expense changes never modify confirmed settlements. The Confirmed Settlement financial lock above supersedes the earlier allowance for old Expense financial edits to recalculate already-settled balance history; only unlocked source history may produce legitimate recalculation or reverse balances.
- Paid By options retain relevant former historical payers. Expense dates remain `YYYY-MM-DD` and are never UTC-round-tripped in a way that shifts the day.
- Filter state may remain local presentation state; URL query persistence is not required. Canonical Expenses, Add Expense, and Expense Details references remain implementation authority across responsive layouts.

## Frozen Phase 10 household-management clarifications

Approved on 2026-08-19:

- Active Household views show current identity, the existing exact nine-digit House Code, current Leader, and active Members. The code is masked by default, supports ephemeral Show/Hide and exact leading-zero-preserving Copy, resets hidden when viewer or Household changes, and has no edit/rotation/regeneration action.
- Active Members list Leader first, then other active Members by display-name code-point order and stable member-ID tie-break. Duplicate/long display names are valid; display name is never identity. Former members are retained but absent from the active list.
- Phase 6 Create/Join/Cancel/Accept/Reject is reused. Accept/Reject transactions revalidate active Household, actor active membership and Leader role, and Pending request; acceptance also revalidates that the requester has no active Household.
- A normal active Member may Leave only at exact zero balance and with no Pending Settlement in either direction. Both owes and is owed block. Terminal Settlements do not block. A Leader with other active members must transfer first; a sole Leader must explicitly Delete. Leave never transfers or deletes automatically.
- The active Leader may Remove only another active non-Leader Member at exact zero balance with no Pending Settlement. Self, Leader, former/inactive, non-zero, and Pending targets are rejected. Leave and Remove retain the last role while changing status to former and release active-membership uniqueness.
- Leadership Transfer requires the current active Leader, another active Member, and an active Household. It ignores balances and Pending Settlements, atomically changes old Leader to active Member and target to active Leader, and preserves exactly one active Leader before and after.
- Household deletion requires the active Leader, every retained ledger balance exactly zero, and no Pending Settlement. Pending Join Requests do not block deletion. One atomic transaction tombstones the Household, changes all active memberships to former while preserving last roles, changes every Pending Join Request to `household-closed`, appends sanitized audits, and rolls back every write on failure.
- `household-closed` is a terminal Join Request status produced only by authoritative Household deletion from Pending. It has zero membership/financial effect, uses the deletion instant and deleting Leader as resolution metadata, releases Pending uniqueness, and reconstructs the requester to no-household. Existing terminal requests remain unchanged. Join Request record V2 adds the status while V1 remains readable; no IndexedDB schema-version bump occurs without a store/key/index change and old records are not rewritten merely to upgrade.
- Household deletion preserves Expenses (including soft-deleted), all terminal Settlements, Receipt metadata, private Cards, private historical Expense Card snapshots, User Profiles, existing audits, and the tombstoned House Code. It does not immediately remove receipt Blobs; available receipt content continues through the ordinary receipt-retention policy. Cards remain independent and usable.
- Former role is historical metadata only. Household authorization always requires active status; Leader authority additionally requires Leader role. Departed/deleted users reconstruct to no-household and cannot use Dashboard, Expenses, Settlements, or active Household views from historical references. Cards and Profile remain independent; no former-member portal or Household rename UI is added.
- Every management preview is advisory. Leave, Remove, Delete, Transfer, Accept, and Reject reread authoritative state at commit. Financial gates recalculate from current non-deleted Expenses plus Confirmed Settlements inside the transaction. A typed `HOUSEHOLD_STATE_CHANGED` conflict commits nothing, reconstructs state, explains the current blocker, and never auto-retries a destructive action.
- Household management never weakens former-member Expense fingerprints or Card privacy. Leaders receive no private Card metadata, private historical Card snapshots, receipt binary content, broad raw audits, or persistence records.
- Deletion uses one explicit destructive confirmation naming the Household and preserved history. No typed-name confirmation is required. The page remains within the established Soft Premium Finance, responsive, keyboard-accessible, non-enterprise visual system.

## Frozen Phase 11 Dashboard, analytics, and Monthly Report clarifications

Approved on 2026-08-19:

- Dashboard defaults to the viewer's current local calendar month. Spent, daily Spending Trend, amount-based Cash/Card Payment Mix, and Recent Expenses use non-deleted Expenses filtered only by date-only Expense Date. Outstanding, Settlement Health, and Housemate Balances remain the current unresolved Household position and never change merely because the selected month changes.
- The Dashboard top area contains only the Calendar/Month Year/Chevron selector and current active-member deterministic initials. It has no visible Dashboard/Overview heading, description, Household hero, or Add Expense action. A screen-reader-only page heading remains permitted for structure.
- Spent is the exact integer-poisha sum of full selected-month Household Expense amounts. Outstanding is the current viewer's net balance split into You Owe for a negative balance and You Are Owed for a positive balance inside one combined card.
- Settlement Health Pending is the household-wide count of active Pending Settlement records. Outstanding is the count of current recommendation edges whose unordered member pair has no active Pending Settlement. A recommendation and any active same-pair Pending claim, including a stale claim, contribute zero Outstanding and one Pending for that pair. Neither count is persisted.
- Daily Spending Trend is one Recharts bar per valid Gregorian day, including zero-spend days, ordered from the first through final day without Expense Date UTC conversion. Payment Mix sums full Expense amounts by Cash/Card, uses deterministic integer basis-point proportions, and produces no percentage from a zero denominator.
- Dashboard Housemate Balances use the Phase 3 current balance engine and active members only. Order current viewer first, then Gets back, Owes, Settled; use absolute magnitude descending within financial groups, display-name code-point order, and stable user ID. Recent Expenses show at most five by Expense Date descending, `createdAt` descending, ExpenseId ascending and expose only generic Cash/Card payment labels.
- Monthly Reports use `/reports/monthly?month=YYYY-MM`, remain absent from primary navigation, and fall back to the current local month for missing/invalid input. Expense metrics use non-deleted Expenses and Expense Date, never `createdAt` for month membership.
- Month comparison uses exact poisha delta and deterministic BigInt percentage rounding only when the previous total is positive. A zero previous total never produces infinity or a fabricated 100%; zero/zero reports no spending in either month.
- Report Amount Paid sums full Expense amounts by payer; Expense Share sums canonical allocations by participant. Include every selected-month payer or participant, including retained former members, and never derive these values from current balances.
- Largest Expenses show at most five by Amount, Expense Date, `createdAt` descending, then ExpenseId ascending. No categories or private Card metadata appear.
- Settlement activity classifies Claims Created by viewer-local `createdAt` month and Confirmed/Rejected/Cancelled by viewer-local `resolvedAt` month. Current Outstanding is separately derived from today's current balance/recommendation state and is never presented as a historical month-end balance. Expense analytics remain timezone-independent date-only calculations; no Household timezone or hardcoded Asia/Dhaka rule is introduced.
- All analytics are derived through pure/testable application/domain-compatible functions into presentation-safe views. React/Recharts aggregate nothing, no analytics result is persisted, chart animation is nonessential/disabled, textual summaries accompany charts, and Dashboard/report reads and retries never mutate source data. The fixed `Asia/Dhaka` calendar applies only to receipt-content retention; it does not change Expense Date or Settlement/report month semantics.

### Approved Dashboard Member Contributions module

**REQUIREMENT CHANGE approved on 2026-08-22 by product owner request.** The Dashboard summary row additionally contains a `Member Contributions` section alongside Spent, Outstanding, and Settlement Health. It lists every payer of the selected month with their exact paid total, derived through the same pure monthly engine as the Monthly Report Amount Paid metric: non-deleted Expenses filtered by date-only Expense Date month, integer poisha sums including retained former members (labeled Former), deterministic ordering by paid amount descending then display-name code-point then member ID, and a reconciliation invariant proving member payments sum exactly to selected-month Spent. The section updates from source data on every runtime reconstruction without persisted aggregates or new financial rules; responsive behavior reflows the four-card row into two columns below 1400px and one column on mobile.
- Responsive and accessibility acceptance includes intentional desktop/tablet/mobile reflow, full-width non-overflowing charts, keyboard month selection, status text beyond color, tabular readable money, approximately 44px important mobile controls, reduced motion, responsive zoom, and zero serious/critical Axe findings.

### Approved month-selector completeness clarification

**CLARIFICATION approved on 2026-08-22 by product owner request after a reported defect.** The Dashboard and Monthly Report month selectors always include the viewer's current local calendar month as a selectable option even when it contains no expenses or settlement activity, so the documented current-month default stays reachable after any other month is selected. The Dashboard additionally retains the viewer's chosen month across client-side navigation within one browser session, keyed per identity and household; a fresh page load still defaults to the current local calendar month.

## Pre-Production Business Logic Hardening

Approved on 2026-08-22. These rules supersede the earlier unlimited Receipt-count statement and the statement that `Asia/Dhaka` applies only to retention. `Asia/Dhaka` now also defines the authoritative current business date for Expense create/edit validation and settlement calendar boundaries; Expense Date storage and historical report/month grouping remain unchanged date-only `YYYY-MM-DD` behavior.

- Future Expense Dates are invalid when greater than the current `Asia/Dhaka` business date derived from the authoritative injected Clock. Same-day and earlier dates are allowed. Existing future-dated history is preserved: non-financial name/receipt changes may proceed where otherwise allowed, while a financial edit must repair the date unless a stronger financial-history lock blocks the edit.
- A post-settlement Expense remains governed by the existing `createdAt` financial lock. Create and financial/date Edit additionally derive the latest same-Household Confirmed Settlement with `resolvedAt < commandInstant`; when the proposed Expense Date is on/before that settlement's Dhaka date, the authoritative command returns `BACKDATED_EXPENSE_CONFIRMATION_REQUIRED` before any Expense, Receipt, audit, or completed idempotency outcome is written. Confirmation binds actor, command type/ID, canonical relevant intent, proposed date, Settlement ID, and `resolvedAt`; a newer boundary requires reconfirmation. Name-only and receipt-only changes with no relevant financial/date change do not repeatedly prompt. `Added after settlement` is derived informational context and never mutates old Settlements.
- Expense aggregate mutation uses a positive monotonic `revision`: create starts at 1; successful Edit/Delete increments exactly once; no-op Edit writes nothing and does not increment. Edit/Delete require `expectedRevision`, reread transaction state, and reject stale intent with `EXPENSE_VERSION_CONFLICT`. After authentication/resource authorization, precedence is version conflict, confirmed-settlement lock, former-member freeze, legacy-percentage unavailability, future date, then receipt/admission validation.
- IndexedDB v5 migrates every valid existing Expense to revision 1 without changing IDs, financial fields, lifecycle timestamps, or audit/history; malformed migration input aborts. It adds the command-outcome store and Receipt admission indexes. Pre-migration forms must reload rather than infer a revision.
- Receipt private metadata/content is readable only by the Expense creator or its historical uploader. A non-creator historical uploader has read-only access. Only the Expense creator may add/remove available Receipt content. Leader status grants neither private read nor management. Other authorized Household viewers receive only a generic attachment-exists projection with no Receipt ID, filename, MIME, size, time, uploader, lifecycle status, Blob/object URL, Storage ID, or checksum. Guessed private IDs normally collapse to `NOT_FOUND`.
- Receipt admission permits at most 3 `available` receipts per Expense, at most 10 MiB per file, and at most 50 MiB of currently available content per uploader. Terminal `user-deleted` and `retention-expired` content releases count/quota. The configurable application receipt budget is 1,000,000,000 bytes with a non-rejecting operational warning at 800,000,000 bytes. Admission transactionally counts committed available plus reserved/in-flight content; ordinary users never receive global or other-user storage usage.
- Production lifecycle timestamps are trusted-system-authoritative. Clients provide intent and the user-controlled Expense Date only. Local mode uses the injected Clock as authority; React never creates authoritative lifecycle timestamps. One command instant is reused for the command's lifecycle and audit fields.
- Durable create commands use actor + command type + opaque command ID idempotency, a canonical intent digest, and a stored outcome. Protected commands include Create Expense, Create Household, Send Join Request, Create Pending Settlement/Mark Paid, Upload Receipt, and Create Card. Same key/same intent returns the original authorized outcome; changed intent returns `IDEMPOTENCY_KEY_REUSED`; actor scopes are isolated; replay authenticates and authorizes again. Backdated confirmation keeps the same command ID and is not a completed outcome.
- Local/provider-independent code defines the policies, revisions, projections, quotas, reservation contracts, command IDs/outcomes, and IndexedDB transactions. It does not claim malicious-client security. Trusted time, cross-device concurrency, Appwrite permissions, organization-wide Storage truth, real reservations/upload saga, orphan reconciliation, scheduled workers, and server-verifiable HMAC confirmation remain separately gated Phase 13 work.

Stable hardening errors are `EXPENSE_DATE_IN_FUTURE`, `BACKDATED_EXPENSE_CONFIRMATION_REQUIRED`, `EXPENSE_VERSION_CONFLICT`, `RECEIPT_COUNT_LIMIT_EXCEEDED`, `RECEIPT_USER_QUOTA_EXCEEDED`, `RECEIPT_PROJECT_CAPACITY_EXCEEDED`, `RECEIPT_PRIVATE_ACCESS_FORBIDDEN`, `IDEMPOTENCY_KEY_REUSED`, and `IDEMPOTENCY_IN_PROGRESS`.
