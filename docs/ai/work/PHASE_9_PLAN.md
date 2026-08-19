# Phase 9 Plan — Private Cards Management

## Status and authorization

Phase 8 is accepted and committed as `c75d18b`. Phase 9 implementation was explicitly approved on 2026-08-18 with the clarifications recorded below, then accepted and committed as `d96451e` on 2026-08-19. Phase 10 and later implementations remain unauthorized.

## Objective and exit outcome

Deliver complete private Card-label management on `/cards` and finish the already-established Phase 7 Expense integration without adding banking behavior:

```text
current user
  -> My Cards
  -> create / edit / remove
  -> active owner-only Card choices in own Expense forms
  -> immutable historical Expense Card snapshots
```

A Card is only a private label for a real-world payment card. It is not a bank account, payment instrument, network token, or transaction source.

Exit requires owner-only projections and repository access, Cards support without a Household, stable approved palette identifiers, correct physical-delete versus archive behavior, transaction-safe Card/Expense integration, all Phase 9 unit/integration/component/Playwright checks, and all Phase 2–8 tests remaining green.

## Exact scope

- Replace the `/cards` placeholder with **My Cards**, an **Add Card** action, privacy copy, active Card grid/list, and approved empty state.
- Create private user-owned Cards with trimmed non-empty name, Debit/Credit type, and one approved palette identifier.
- Allow duplicate names and impose no Card-count or arbitrary name-length limit.
- Edit the owner’s active Card name, type, and color without changing any historical Expense snapshot.
- Determine removal behavior from actual Expense references:
  - never referenced: physical delete;
  - referenced at least once: archive.
- Exclude archived Cards from the normal Cards grid and all new Expense Card selections.
- Preserve archived Card records and every existing private Expense snapshot.
- Preserve an archived association during owner editing of an existing Expense; allow switching it to Cash or another active owned Card.
- Work for the current development user with active, pending, former, or no Household state; `/cards` remains outside the Household access gate.
- Refresh Card data after mutations and development identity switching.
- Replace the Phase 7 “arrives in Phase 9” no-Card copy with a direct path to `/cards` while Cash remains available.
- Normalize existing local seeded Card colors and private Expense snapshot colors to approved stable identifiers through a tested IndexedDB migration.
- Strengthen atomic Expense writes so a newly selected Card is still current, active, and owned when the Expense transaction commits.
- Keep Card lifecycle metadata out of broad household audit projections.

## Explicit exclusions

- Real banking integration, bank APIs, payment processing, or real transaction data.
- Card number, last four digits, CVV, expiry, bank credentials, network tokens, or other sensitive instrument data.
- Visa, Mastercard, bank names, bank logos, or realistic payment-card branding.
- Custom colors, arbitrary color strings, gradients, or a free-form color picker.
- Card transaction history, balances, statements, imported transactions, or analytics.
- An archived-Cards page, restore/unarchive workflow, or archived filter in Phase 9.
- Card sharing, Household-owned Cards, leader Card administration, owner selection, or ownership transfer.
- Card-name uniqueness and Card-count limits.
- Dashboard, Reports, full Household management, Appwrite, or real authentication.
- Rewriting Phase 7 Expense architecture or historical Card snapshots.
- A Card activity/history UI or a new owner-private audit store unless separately approved later.

## Approved palette and domain representation

Persist a stable `CardColorId`, never a hex value or arbitrary user string:

| Identifier | Label | UI hex |
|---|---|---|
| `mint` | Mint | `#CFF4E2` |
| `powder-blue` | Powder Blue | `#DDEBFF` |
| `lavender` | Lavender | `#E8E1FF` |
| `warm-sand` | Warm Sand | `#F4E7D3` |
| `soft-coral` | Soft Coral | `#FFDCD5` |
| `charcoal` | Charcoal | `#282828` |

The domain validates the closed identifier union. Presentation alone maps identifiers to labels and hex values. Card color remains supplementary: name and Debit/Credit text are always visible. Pastels use dark text; Charcoal uses high-contrast light text. The recommended visual is a restrained accent panel or stripe rather than a realistic plastic-card replica.

## Card lifecycle model

```text
create -> active -> edit active details
                  -> remove preview
                       -> unreferenced -> physically deleted
                       -> referenced   -> archived (terminal in Phase 9 UI)
```

- Owner is always the current session user and is never accepted from form input.
- Only active Cards can be edited or newly selected.
- Archived Cards remain owner-private and internally addressable for historical integrity, but are absent from ordinary Card lists and selectable options.
- Physical deletion is permitted only when the Card has no private Expense snapshot reference.
- Duplicate names are valid; Card IDs remain the internal identity.
- `createdAt`, `updatedAt`, and `archivedAt` remain persistence/application data and are not shown on the Phase 9 Cards page.

## Component hierarchy

```text
src/app/(product)/cards/page.tsx                 thin Server Component
└── CardsPageClient                              load/reload/mutation orchestration
    ├── PageHeader
    │   └── Add Card button
    ├── privacy description
    ├── CardsLoadingState / CardsErrorState
    ├── CardsEmptyState
    │   └── Add Card button
    ├── ActiveCardGrid
    │   └── CardTile[]
    │       ├── name + Debit/Credit text
    │       ├── restrained palette treatment
    │       ├── “Private to you”
    │       └── CardActionsMenu
    │           ├── Edit
    │           └── Delete or Archive
    ├── CardFormDialog                           shared Add/Edit RHF + Zod form
    │   ├── Card Name input
    │   ├── Card Type radio/select
    │   └── CardPaletteRadioGroup
    ├── RemoveCardDialog                         exact consequence copy
    └── polite live mutation feedback / toast
```

Use the established `PageContainer`, `PageHeader`, `Surface`, `Button`, `Input`, `Label`, async states, Sonner, and Radix-backed dialog primitives. Add a keyboard-safe contextual menu primitive only if the existing dependency can supply it without a new paid service or unrelated library.

## Presentation-safe Card models

React receives narrow immutable application projections, not domain/persistence `Card` records:

```text
CardPageView
  cards[]: MyCardSummaryView

MyCardSummaryView
  cardId
  name
  type: debit | credit
  colorId: approved CardColorId
  removalKind: delete | archive

SelectableCardView
  cardId
  name
  type
  colorId

CardRemovalPreview
  cardId
  name
  expectedAction: delete | archive
  title
  description
```

These projections omit `ownerId`, timestamps, archived records, repository records, audit data, and all other users’ Cards. The owner-visible `cardId` exists only where selection/removal requires it. Non-owner Expense projections continue to contain only `{ method: "card" }` and receive no Card ID, name, type, color, or snapshot object.

## Application services and use cases

Refactor the existing `CardApplicationService` into implicit-current-user use cases:

1. `getMyCards()`
   - Resolves the actor from `CurrentSession`.
   - Uses only `CardRepository.listOwned(actor, false)`.
   - Produces active `MyCardSummaryView` records and owner-scoped removal consequences.
   - Does not require or load Household membership.

2. `listMySelectableCards()`
   - Returns only active owner-scoped `SelectableCardView` values for Expense forms.
   - Never returns raw `Card`, `ownerId`, archived Cards, or another user’s records.

3. `createMyCard(command)`
   - Accepts only `name`, `type`, and `colorId`.
   - Trims and validates name, validates the two allowed types and closed palette, derives owner from session, creates ID/timestamps, and persists atomically.
   - Performs no uniqueness or Household check.

4. `updateMyCard(cardId, command)`
   - Loads with owner-scoped `getOwned(cardId, actor)` and treats foreign/missing/archived IDs as `NOT_FOUND`.
   - Updates only name/type/color/current timestamp.
   - Never enumerates or rewrites `expenseCardPrivateDetails`.

5. `getMyCardRemovalPreview(cardId)`
   - Verifies ownership first, then determines whether any retained private Expense snapshot references the Card.
   - Returns the exact Delete or Archive copy, without exposing Expense IDs or counts.

6. `deleteOrArchiveMyCard(cardId, expectedAction)`
   - Resolves owner from session and delegates to one atomic persistence operation.
   - Transactionally rechecks ownership, current active state, and actual reference existence.
   - If the expected Delete consequence changed to Archive, returns a conflict and requires refreshed archive confirmation rather than silently changing the destructive consequence.
   - Returns the committed `deleted` or `archived` result for accurate feedback.

Card mutations do not receive an owner or Household ID from React.

## Create Card workflow

1. User activates **Add Card** from header or empty state.
2. Accessible dialog opens with focus on Card Name.
3. Form collects only Card Name, Card Type, and approved Card Color.
4. Zod trims the name and rejects empty input; domain validation repeats the invariant.
5. Submit disables duplicate submission and exposes busy state.
6. Application derives owner, persists, reloads `getMyCards()`, closes the dialog, returns focus, and announces success.
7. Duplicate names are accepted. No owner, bank, number, or credential fields exist.

## Edit Card workflow

1. Owner opens the tile’s keyboard-operable actions menu and chooses **Edit**.
2. The shared form dialog is populated from `MyCardSummaryView`.
3. Owner may change name, Debit/Credit type, and approved color.
4. Application rechecks ownership and active state and persists only the Card record.
5. Page and future Expense choices show current values.
6. Existing Expense snapshots remain byte-for-byte/domain-value unchanged and continue to display the historical name/type/color.

## Delete and archive behavior

The menu and confirmation use the application-projected consequence:

- Unreferenced: **Delete Personal Card?** / “This card has never been used by an expense and will be permanently removed.”
- Referenced: **Archive Salary Card?** / “This card has been used by previous expenses. It will no longer be available for new expenses, but historical records will remain unchanged.”

Deletion removes only the Card record. Archiving sets `archivedAt`/`updatedAt`. Neither path deletes or updates an Expense or historical snapshot. The final persistence transaction, not the UI preview, is authoritative. No archived view or restore action is added.

## Historical Expense snapshot behavior

- New Card Expense: snapshot current `cardId`, name, type, and `colorId` in `expenseCardPrivateDetails` at Expense creation.
- Card edit: update only the Card record; all earlier snapshots remain unchanged.
- Existing Expense preserve: if its snapshot Card is archived, retain the existing payment and private snapshot without requiring the current Card record to be active.
- Existing Expense to Cash: allowed under the existing confirmation rule; retained historical snapshot storage is not destroyed, while the current Expense view is Cash.
- Existing Expense to another Card: require a current active owned Card and replace the current private snapshot with that Card’s current values.
- Non-owner/leader edit: retain the existing opaque reference under Phase 7 rules and never load private snapshot metadata.
- Physical delete: possible only when no snapshot references the Card, so it cannot affect any Expense.

## Atomic Card and Expense persistence

- Card create/update verify domain shape and owner consistency at the persistence boundary.
- One `deleteOrArchiveCard` transaction spans `cards` and `expenseCardPrivateDetails`, performs the reference check, and commits exactly one branch.
- Expense creation transactions receive only the selected Card identity, add `cards` to their store set, verify at commit time that the Card exists, belongs to the creator, and is active, then derive the historical snapshot from that authoritative record.
- Expense edit transactions distinguish an unchanged existing snapshot from a newly selected Card:
  - unchanged/opaque preserve may retain an archived Card;
  - new or changed association must revalidate an active owned Card and current snapshot values.
- Because Card removal and Card-selecting Expense writes overlap the `cards` and `expenseCardPrivateDetails` stores, IndexedDB serializes them and prevents a new association from committing against a concurrently archived/deleted Card.
- A missing, foreign, or archived selection returns a typed conflict and leaves the Expense, Card, receipts, and audit writes unchanged; a concurrent permitted Card edit is reflected by the authoritative snapshot created inside the transaction.

## Privacy model

```text
CardsPage / Expense form
  -> owner-scoped runtime actions
  -> Card application projections
  -> owner-required CardRepository methods
  -> IndexedDB ownerId index / atomic persistence
```

- Presentation never imports repositories, IndexedDB, mappers, records, or domain `Card` records.
- Card repository reads always require the current owner ID; no household-wide or all-Card query is added.
- Foreign IDs return the same `NOT_FOUND` shape as missing IDs.
- Leader status grants no Card capability.
- Identity switching reconstructs session state and reloads owner-scoped Cards; stale responses are ignored/cancelled so the prior user’s data cannot flash for the next user.
- Household Expense viewers receive only the existing public `Card` payment method. Owner-private snapshot reads remain guarded by creator/owner equality.
- No Card values, IDs, commands, form state, or snapshots are logged.

### Audit handling

The existing `AuditEvent` is Household-scoped and requires a Household ID plus aggregate ID. Using it for a private resource that works without a Household would either invent a fake Household or expose a Card reference in broad Household data. Phase 9 therefore removes Card lifecycle writes from the broad household audit stream. Card timestamps retain operational metadata; an owner-private Card audit store and activity UI remain out of scope unless separately approved. This satisfies the rule that Card audit data be private or sanitized and avoids fabricating architecture.

## Cards with no Household

`/cards` already sits outside `HOUSEHOLD_REQUIRED_ROUTE_PREFIXES`; preserve that. Remove membership lookups from Card create/update/remove. A current development session identity is the only ownership prerequisite. Pending join-request and no-household users receive the same Cards functionality and normal responsive shell as active household users.

## Empty, loading, and error states

- Empty: **No cards yet** / “Create a private card label to remember which real-world card you used.” / **Add Card**.
- Initial/loading and identity-switch loading: established skeleton or `LoadingState`, with no stale previous-owner Cards.
- Page read error: established `ErrorState` with owner-safe copy and Retry.
- Form validation: inline field errors; retain dialog values and focus the first invalid field.
- Mutation error/conflict: dialog remains open where recovery is possible; announce an owner-safe message without raw IDs.
- Delete-to-archive consequence drift: close/reload or refresh the confirmation in place and require explicit Archive confirmation.

## Expense integration changes

- Replace `ExpenseApplicationActions.listSelectableCards(): Promise<Card[]>` with `listMySelectableCards(): Promise<SelectableCardView[]>`.
- Active created/edited Cards appear on the next Expense form load/reload with current values.
- Archived Cards disappear from new choices.
- Existing owner Expense edit injects only its historical snapshot as the “Keep {name} (archived)” option when that Card is absent from active choices.
- Choosing the unchanged historical option sends `preserve`; choosing Cash or a different active ID uses existing Phase 7 edit commands.
- Replace the Phase 7 placeholder sentence with “No cards available. Add a private card label in My Cards, or use Cash.” and a `/cards` link/action.
- Owner Expense details render the historical color label/swatch through the approved palette mapping; non-owners continue to see only **Payment Method: Card**.

## Responsive strategy

- `<640px`: one-column Card list, full-width primary Add action where useful, 44px menu/action controls, dialog content sized to viewport with safe scrolling, palette options in a readable one/two-column layout.
- `640–767px`: one or two columns only when long names and controls remain comfortable.
- `768–1023px`: responsive two-column grid under the existing mobile/tablet shell.
- `1024–1279px`: desktop sidebar and two/three-column Card grid based on available content width.
- `1280px+`: airy three-column maximum within the existing page max width; do not stretch into realistic card proportions.
- Names have no arbitrary max, so tiles wrap safely, menus remain reachable, dialogs do not overflow, and no horizontal scrolling appears at approved breakpoints or zoom.

## Accessibility behavior

- Logical heading order and labelled My Cards region/list.
- Every Card exposes name, Debit/Credit, palette label, and “Private to you” as text; color is never the only identifier.
- Palette uses a labelled native/Radix radio group with keyboard arrow navigation, visible focus, text labels, checked state, and assistive-technology selection state.
- Actions menu opens from an approximately 44px ellipsis button with a descriptive accessible name and supports Enter/Space, arrows, Escape, focus return, and outside dismissal.
- Duplicate Card names remain distinguishable by type/color context; action names may include item position when otherwise identical.
- Add/Edit and removal dialogs have programmatic title/description, focus trap, Escape behavior, initial focus, error focus, and trigger focus return.
- Destructive confirmations name the Card and exact Delete/Archive consequence.
- Pending controls expose `aria-busy`; success uses polite status and failures use alerts without leaking private identifiers.
- Color contrast, zoom, reduced motion, touch targets, and Axe serious/critical findings follow the established baseline.

## IndexedDB palette migration

Increase the local database schema version from 2 to 3 and migrate Card records plus `expenseCardPrivateDetails` snapshots to record version 2 with `colorId`/`colorIdSnapshot`.

Recommended legacy normalization:

- `lime` -> `mint`
- `blue` -> `powder-blue`
- `gray` -> `charcoal`
- already-approved identifiers -> unchanged
- any unexpected legacy token -> abort the migration through the existing typed persistence/migration error path without including private Card data in the error

The migration changes only known legacy color tokens; it preserves Card/snapshot IDs, owner, name, type, timestamps, archive state, and Expense association. An unexpected value is malformed/unsupported persistence and must abort the versionchange transaction atomically rather than be silently rewritten. Tests must prove existing v2 data opens, both current Card and historical snapshot normalize consistently, an unknown value produces a non-sensitive typed failure with no partial upgrade, and close/reopen retains successful results.

## Proposed files

### New

- `docs/ai/work/PHASE_9_PLAN.md`
- `src/domain/cards/card-color.ts`
- `src/application/cards/card-page.ts`
- `src/application/cards/card-page.test.ts`
- `src/application/validation/card-form.schema.ts`
- `src/application/validation/card-form.schema.test.ts`
- `src/presentation/cards/cards-page.client.tsx`
- `src/presentation/cards/card-form-dialog.tsx`
- `src/presentation/cards/card-palette-radio-group.tsx`
- `src/presentation/cards/card-actions-menu.tsx`
- `src/presentation/cards/remove-card-dialog.tsx`
- `src/presentation/cards/card-ui.test.tsx`
- `src/components/ui/dropdown-menu.tsx` only if required for the accessible contextual menu
- `tests/e2e/cards.spec.ts`

### Modify

- `src/app/(product)/cards/page.tsx`
- `src/domain/records/domain-records.ts`
- `src/application/repositories/index.ts`
- `src/application/services/application-services.ts`
- `src/application/services/application-services.integration.test.ts`
- `src/infrastructure/indexeddb/records.ts`
- `src/infrastructure/indexeddb/mappers.ts`
- `src/infrastructure/indexeddb/database.ts`
- `src/infrastructure/indexeddb/repositories.ts`
- `src/infrastructure/indexeddb/atomic-persistence.ts`
- `src/infrastructure/indexeddb/seed.ts`
- `src/infrastructure/indexeddb/phase-4.integration.test.ts`
- `src/app/_providers/local-application-runtime.client.tsx`
- `src/presentation/runtime/application-runtime-context.tsx`
- `src/presentation/expenses/expense-form-page.client.tsx`
- `src/presentation/expenses/expense-details-page.client.tsx`
- relevant Expense/component/architecture/route tests
- `docs/ai/PROJECT_RULES.md`
- `docs/ai/PROJECT_STATE.md`
- `docs/ai/work/ACTIVE_PLAN.md`
- `docs/ai/AI_LESSONS.md` only for durable implementation discoveries

No Appwrite file, Route Handler, Server Action, or new paid dependency is proposed.

## Test matrix

| Layer | Required coverage |
|---|---|
| Domain/validation | all six palette IDs accepted; arbitrary color rejected; Debit/Credit only; name trimmed; empty name rejected; no arbitrary max; duplicate names allowed; active/archive invariants |
| Application projection/privacy | zero Cards; current owner only; foreign/missing IDs indistinguishable; leader cannot read member Cards; no owner/timestamps/raw record in views; no Household required; pending/no-household identity supported |
| Create/edit | create Debit; create Credit; every palette; implicit owner; edit name/type/color; archived edit rejected; duplicate names persist |
| Historical snapshot | editing current Card does not alter old Expense name/type/color; future Expense uses edited current values; owner-only snapshot visibility; non-owner and leader receive only Card payment method |
| Remove lifecycle | exact delete preview/copy; exact archive preview/copy; unreferenced physical delete; referenced archive; archived excluded from active page/selection; snapshot retained; stale Delete consequence requires refreshed Archive confirmation |
| Expense edit | archived association preserved; archived not newly selectable; archived -> Cash; archived -> active Card; leader opaque preserve unchanged; unreferenced deletion has no Expense effect |
| Atomic persistence | create/update ownership recheck; delete/archive branch in one transaction; Card-selection versus archive/delete race; Card edit versus Expense snapshot race; transaction rollback leaves Card/Expense/snapshot/receipts/audits consistent |
| Migration | IndexedDB v2 -> v3 known-token mapping; approved IDs retained; unexpected token typed failure and atomic rollback; Card and historical snapshot preservation; native close/reopen persistence |
| Components | loading/error/empty; Add/Edit forms; palette radio semantics; action menu keyboard behavior; exact confirmations; mutation busy/error/success; focus trap/return; long and duplicate names |
| Playwright | zero Cards; create Debit/Credit; edit; duplicate names; owner isolation and leader privacy; referenced archive; unreferenced delete; Expense create/select; archived Expense preserve/switch; identity switching; no-Household Cards; close/reopen |
| Responsive/accessibility | 390x844, tablet, 1440x900; no overflow; ~44px important mobile targets; keyboard-only journey; Axe zero serious/critical; color-independent labels; focus return |
| Regression | full Vitest including architecture guards; lint; TypeScript; production build; full Chromium Playwright Phase 2–8; dependency audit; `git diff --check`; no console/page/hydration/runtime errors |

## Unresolved decisions and recommended resolutions

1. **Household-bound audit model conflicts with private no-Household Cards.** Recommended: do not emit Card events into broad Household audit data; defer a private audit store until a Card activity requirement exists.
2. **Legacy arbitrary color tokens conflict with the closed palette.** Approved resolution: migrate only the three known legacy tokens and already-approved identifiers; abort atomically with a non-sensitive typed persistence/migration error for every unexpected value.
3. **Delete preview can become stale if an Expense starts referencing the Card.** Recommended: send the expected consequence and transactionally reject consequence drift so Archive always receives separate consent.

All three resolutions are approved. No frozen business rule remains undefined for implementation; stop if a new privacy or historical-snapshot ambiguity appears.

## Risks and mitigations

1. **Expense selection can race Card edit/archive/delete.** Overlap IndexedDB transaction stores and revalidate the active owned Card plus exact snapshot at commit time.
2. **Identity switching can briefly display stale private state.** Clear the page on session user change and ignore stale async completions before rendering the new owner’s projection.
3. **Unlimited/duplicate names can stress layout or make identical items hard to distinguish.** Preserve the approved unlimited/duplicate policy, wrap safely, show type/color text, and add positional accessible context for otherwise identical action controls.

## Recommended model and reasoning level

Use **GPT-5.6 Sol (`gpt-5.6-sol`) with high reasoning** for Phase 9 implementation. The UI is contained, but owner-only privacy, IndexedDB migration, cross-resource atomicity, historical snapshots, and regression-sensitive Expense integration make this quality-first work. `xhigh` is optional for a final privacy/concurrency review if high-effort verification exposes ambiguity; `max` is unnecessary unless a concrete migration or race defect resists diagnosis. For a cost-balanced execution after the plan is stable, **GPT-5.6 Terra with high reasoning** is the fallback.

## Entry and exit gates

Entry:

- Explicit user approval of this Phase 9 plan and its clarified resolutions (received 2026-08-18).
- Re-read AIDOS documents and relevant Next.js 16.3 bundled guidance before implementation.
- Confirm the worktree contains only the approved planning changes after `c75d18b`.

Exit:

- Complete owner-private Cards page and Expense integration implemented with no banking data.
- Privacy, lifecycle, migration, atomicity, responsive, accessibility, and regression matrix green.
- AIDOS state/plan/lessons updated with verified evidence.
- Stop for Phase 9 review; do not begin Phase 10.
