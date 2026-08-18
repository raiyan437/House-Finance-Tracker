# Phase 7 Plan - Expenses and Receipts

## Status and intended outcome

Planning and implementation are explicitly approved. This phase will deliver the complete local household Expense experience on the existing domain, application, repository, IndexedDB, and responsive shell foundations. It will not add Appwrite, real authentication, or later-phase product areas. Phase 8 remains unauthorized, and the completed Phase 7 tree must remain uncommitted for review.

Approved execution: GPT-5.6 Codex (`gpt-5.6-sol`) with **high reasoning** for the financial, privacy, temporal-history, atomic-persistence, and multi-user portions.

## Exact scope

- Household-only expense list with name search, expense-month filter, Paid By filter, Cash/Card filter, and expense-date sorting. Default sort is newest to oldest; oldest to newest is optional.
- Clickable desktop rows and mobile cards that open a dedicated Expense Details route.
- One-page Add Expense form with name, strict BDT amount, date-only expense date, fixed current-user payer shown as `You`, Cash/Card selection, current active household participants, Equal/Amount/Percentage split modes, live allocation feedback, optional multiple receipts, and a summary.
- Owner-only selection from the current user's active, non-archived private cards. Cash persists no card reference. A no-card state remains usable without Card CRUD.
- Atomic creation of the expense, optional private card snapshot, receipt metadata, receipt Blobs, and audit history through the existing named application/infrastructure transaction boundary.
- Details with payer/payment/split/participants/shares, authorized receipts, supported audit activity, permission-aware Edit/Delete actions, and historical private card information only for the owner.
- Creator/leader editing with full financial revalidation, owner/non-owner card constraints, former-member history protection, retained confirmed settlements, and natural recomputation from source records.
- Creator/leader soft deletion with explicit destructive confirmation; deleted expenses disappear from default lists and derived calculations while historical records remain.
- Responsive desktop, tablet, and mobile behavior plus the Phase 7 accessibility baseline.

## Explicit exclusions

- Financial Dashboard, settlements UI, settlement lifecycle UI, Cards-management CRUD, full Household management, reports, analytics beyond the expense list, Appwrite, production authentication, categories, recurring expenses, budgets, OCR/image processing, notifications, and export.
- No derived balance persistence, new currency, receipt count cap, base64 receipt storage, thumbnails, image transforms, external image/storage service, paid dependency, or speculative persistence abstraction.
- No ability to choose another user's private card, expose private card metadata to a leader/non-owner, edit confirmed settlements, or change historical former-member financial positions.

## Routes and component hierarchy

All `page.tsx` files remain Server Components. They render focused Client Components because the local runtime and IndexedDB are browser-only.

```text
src/app/(product)/layout.tsx
`- LocalApplicationRuntime -> AppShell -> HouseholdAccessGate
   `- /expenses
      |- page.tsx
      |  `- ExpensesPageClient
      |     |- PageHeader + Add Expense link
      |     |- ExpenseFilterBar
      |     `- ExpenseList
      |        |- desktop table/list hybrid
      |        `- mobile expense cards
      |- /new/page.tsx
      |  `- ExpenseFormPage mode=create
      |     |- Expense details section
      |     |- Payment section
      |     |- ReceiptPicker
      |     |- ParticipantSelector
      |     |- SplitEditor
      |     `- ExpenseAllocationSummary
      `- /[expenseId]
         |- page.tsx
         |  `- ExpenseDetailsPageClient
         |     |- detail/financial sections
         |     |- ParticipantShares
         |     |- ReceiptGallery/Viewer
         |     |- ExpenseActivity
         |     `- permission-aware Edit/Delete actions
         `- /edit/page.tsx
            `- ExpenseFormPage mode=edit
               `- shared form architecture with edit/card/history policy
```

Dynamic route pages will await the Next.js 16 `params` promise and pass only the serializable ID string into the client boundary. No route handler or Server Action is needed.

## Application services and use cases

The existing `ExpenseApplicationService`, `ReceiptApplicationService`, `CardApplicationService`, repository ports, and named IndexedDB transactions remain the foundation. Phase 7 will add presentation-safe use cases rather than exposing repositories or raw records.

1. `getExpenseListModel()`
   - Requires the current user to be an active member of exactly the requested/current household.
   - Returns only non-deleted household expenses by default, public member/payer labels, filter options, and no private card reference or snapshot.
   - Includes former payers in Paid By options when retained history contains their expenses, labelled as former.

2. `applyExpenseListQuery(rows, query)`
   - Pure application-level composition for name search, month, payer, payment method, and sort.
   - Keeps filtering/sorting semantics and date-only handling out of React and IndexedDB.

3. `getExpenseEditorModel(expenseId?)`
   - Create mode returns current actor/payer, all active household members selected, active owner-private cards, Cash default, and a local date-only default.
   - Edit mode returns safe initial fields, permissions, active participant choices, retained historical participants, receipt metadata, and an explicit financial-edit policy.
   - Non-owner leaders never receive the private card reference, card ID, snapshot, name, type, or color.

4. `previewExpenseDraft(rawDraft)`
   - Uses strict Phase 2 money/percentage/date parsing and domain split functions.
   - Returns parsed totals, allocations or provisional status, allocated/remaining amounts, basis-point status, current-user share, participant count, field/root issues, and whether Save is allowed.
   - React renders this result and performs no poisha/basis-point arithmetic.

5. `createExpense(rawSubmission, receipts)`
   - Rechecks active membership and validates every participant as a current active household member.
   - Parses and allocates through the domain engine, validates an owner-private active card when Card is selected, validates receipt metadata/content, then commits all records atomically.
   - Returns the new expense ID for navigation to details.

6. `getExpenseDetails(expenseId)`
   - Enforces active household visibility and returns public names, exact shares, receipt metadata, safe audit activity, and `canEdit`/`canDelete` capabilities with reasons.
   - Returns the historical private card snapshot only when viewer equals expense creator/owner.
   - Deleted records remain directly viewable as read-only retained history but stay absent from default lists.

7. `editExpense(rawSubmission, receiptChanges)`
   - Rechecks current record/version, permissions, active-member inputs, split validity, card policy, and former-member policy.
   - Atomically updates the expense/private snapshot, adds receipt Blobs, tombstones removed receipt metadata, removes their Blobs, and appends safe audit events. A failure leaves both persisted state and form state unchanged.
   - Rejects edits to already deleted expenses.

8. `deleteExpense(expenseId)`
   - Rechecks current permissions and former-member policy, applies a soft-delete tombstone and audit event, and never touches settlement records.

9. Receipt read/delete actions
   - Read requires active membership and expense visibility. Delete requires expense edit permission.
   - The existing tombstone plus Blob-removal transaction remains authoritative.

The runtime context will expose only presentation-facing expense actions and safe DTOs. IndexedDB objects, repositories, atomic persistence objects, opaque private references, and infrastructure errors remain outside React state.

## Expense form state architecture

React Hook Form owns serializable form values; a small receipt-draft state owns browser `File` objects and object URLs.

```text
ExpenseFormValues
|- name: string
|- amountText: string
|- expenseDate: YYYY-MM-DD text
|- paymentMethod: cash | card
|- selectedCardId?: string (owner-create/owner-edit only)
|- selectedParticipantIds: string[]
|- splitMethod: equal | amount | percentage
|- amountTextByParticipant: Record<userId, string>
`- percentageTextByParticipant: Record<userId, string>

ReceiptDraftState
|- existing receipt projections
|- pending File additions with object URLs and per-file errors
`- existing receipt IDs marked for removal
```

- Participant values are keyed by stable user ID, not array index. Toggling a participant or split method keeps that participant's draft text during the current form session.
- Create mode selects every active member by default, including the payer. Anyone may be excluded, but Save requires at least one participant.
- Amount/percentage blanks remain distinct from explicit zero so exact zero-share participants can be saved without silently dropping them.
- `useWatch` feeds raw values to the application preview helper. The component never sums money, converts percentages, distributes remainders, or builds persisted allocations.
- A root submission error and field-associated errors remain visible without resetting values. Duplicate submission is blocked; focus moves to the first invalid field or the error summary.
- Create mode navigates to details only after the atomic commit. Cancel/navigation requires no persisted cleanup because attachments remain draft-only.
- Edit mode stages receipt adds/removals until Save, avoiding irreversible receipt mutations when the user cancels.

## Split-method behavior

- Equal: call the existing deterministic equal allocator. Stable participant-ID order receives remainder poisha. Render every selected member, including zero-poisha shares.
- Amount: parse each explicit amount with the strict money parser. Use the existing amount summary/allocator for `Allocated`, signed `Remaining`/`Over by`, exactness, and final allocations. Save is blocked unless every selected participant has an explicit valid entry and remaining is exactly zero.
- Percentage: parse normal percentage text into integer basis points. A domain/application summary reports total/remaining/over basis points. While the draft is not exactly 10,000 basis points, per-row amounts are explicitly provisional BigInt floor previews; once exact, the existing deterministic largest-remainder allocator supplies the final displayed and persisted shares. Save is blocked unless the total is exactly 10,000 basis points.
- The summary always receives integer poisha/basis-point values. BDT formatting is display-only and never feeds back into calculations.

## Receipt workflow

- File input accepts JPEG, PNG, and WebP, multiple selection, 1 byte through 10 MiB each, and no invented count limit.
- Selection creates object-URL previews; removing a pending item revokes its URL. All URLs are revoked on unmount/success. No base64 or image processing is introduced.
- Presentation performs fast type/size feedback; authoritative byte-signature, metadata-size, MIME, authorization, and persistence checks remain in application/infrastructure boundaries.
- On submit, files are read to byte arrays without altering the RHF state. Read/validation/persistence errors stay attached to the receipt section and preserve every other field and valid draft attachment.
- Create persists the expense, receipt metadata, Blob records, private card snapshot if any, and audit atomically.
- Edit stages adds/removals and saves them with the expense transaction. Direct receipt deletion from details uses the approved receipt tombstone + Blob deletion flow.
- Details lazily reads authorized receipt content, reconstructs Blob URLs for viewing, and provides keyboard-accessible thumbnail buttons, alt text derived from safe filenames/ordinal labels, removal controls only for editors, loading/error states, and a dialog/sheet viewer.
- The signature-only seeded PNG is not relied upon for visual proof; browser tests upload a real valid image and verify reload persistence.

## Edit, delete, and temporal-history workflow

- Creator and active House Leader receive Edit/Delete capabilities. Other active members are view-only. Non-members receive no expense projection.
- Payer is immutable in the UI. On the creator's form it is displayed as `You`; a leader editing another creator sees that payer's public name.
- Every financial edit rebuilds a complete allocation through the strict parser/domain path and calls the existing former-member fingerprint policy.
- If the expense involves a former payer/participant, financial controls and Delete are disabled with explanatory text; only provably non-financial fields such as the name and receipt lifecycle remain editable. A membership change between load and submit is rechecked and rejected safely.
- Confirmed settlements are never updated, deleted, or recalculated in storage. Balance consumers later recompute from active expense source history plus immutable confirmed settlements.
- Delete uses an accessible destructive confirmation, then writes `deletedAt`/`deletedByUserId` and an audit event. It never hard-deletes the expense, allocations, private historical card snapshot, receipt metadata, or audit history.

## Card privacy behavior

- Add and owner-edit models call the existing owner-scoped card service and include only active/non-archived cards owned by the current actor.
- Cash submissions contain no card ID/reference and remove the private snapshot when an authorized edit confirms Card -> Cash.
- Expense owner details may include the historical owner-private snapshot: private card ID, name, Debit/Credit type, and color.
- Every non-owner view contains only `{ method: "card" }`. The private snapshot/reference never enters the leader DTO, runtime context, form defaults, HTML, logs, toast text, or audit changed fields.
- A leader editing another user's Card expense receives `opaque-card` mode: preserve Card or explicitly confirm Card -> Cash. No card picker is returned.
- A leader editing another user's Cash expense receives locked Cash mode and cannot change Cash -> Card. Service/domain checks repeat these constraints even if the UI is bypassed.
- If the owner has no active card, Card selection shows a clear no-card state and Save remains blocked for Card; Cash remains fully usable. No Card CRUD is added.

## Search, filter, and sort semantics

- Scope: active, non-deleted expenses for the current active household only.
- Search: trimmed, case-insensitive substring match on expense name only. Whitespace-only search behaves as no search.
- Month: exact `expenseDate.slice(0, 7) === YYYY-MM`; never `createdAt`, never UTC conversion. Options include months present in the list plus the current local calendar month and `All months`.
- Paid By: exact payer ID. Options include public profiles for payers in retained household expense history, including former payers when relevant.
- Payment: exact Cash or Card; default is All.
- Sort: Expense Date descending by default or ascending when selected. Newest uses Expense Date descending, then `createdAt` descending, then ExpenseId ascending. Oldest uses Expense Date ascending, then `createdAt` ascending, then ExpenseId ascending. Repository/input order never decides display order.
- All predicates compose with logical AND before sorting. Empty results retain the active filters and offer Clear Filters/Add Expense actions.
- Query state remains simple local presentation state. Phase 7 has no URL-state requirement; do not turn filters into routing infrastructure.

Approved defaults are current local calendar month, All payers, All payment methods, and Newest to Oldest. Clear Filters restores those defaults. Expense Date defaults to the current local calendar day assembled from local date parts, never `toISOString()`.

## Responsive and accessibility strategy

- Desktop (`>=1024px`): approved header/CTA and filter hierarchy; table/list hybrid surface; Add/Edit uses a wide form column plus sticky summary; Details uses primary content plus a compact financial/action rail.
- Tablet (`768-1023px`): two-column filter controls where space permits, readable list rows, one-column form with inline summary, and no desktop-sidebar assumptions.
- Mobile (`<768px`): expense rows become stacked cards; filter controls wrap/stack; Add/Edit remains one continuous scrollable form; summary and actions remain in document flow; receipt gallery and details become one column.
- Existing shell bottom clearance and safe-area handling remain authoritative. No fixed form action bar may cover fields or controls.
- Use semantic headings, `form`/`fieldset`/`legend`, associated labels and error IDs, live status text, keyboard-operable row/card links, dialog focus trapping/return, visible focus, non-color status labels, and approximately 44px mobile targets.
- Loading, empty, error, permission, no-card, invalid-allocation, saving, and success states are explicit. Reduced-motion behavior remains inherited from the shell.

## Proposed files

New route files:

- `src/app/(product)/expenses/[expenseId]/page.tsx`
- `src/app/(product)/expenses/[expenseId]/edit/page.tsx`

Replace placeholder routes:

- `src/app/(product)/expenses/page.tsx`
- `src/app/(product)/expenses/new/page.tsx`

New application helpers/tests:

- `src/application/expenses/expense-form.ts`
- `src/application/expenses/expense-query.ts`
- `src/application/validation/expense-form.schema.ts`
- `src/application/validation/expense-form.schema.test.ts`
- `src/application/services/expense-application-service.integration.test.ts`

New presentation files/tests (component boundaries may be combined if a file would remain trivial):

- `src/presentation/expenses/expenses-page.client.tsx`
- `src/presentation/expenses/expense-filter-bar.tsx`
- `src/presentation/expenses/expense-list.tsx`
- `src/presentation/expenses/expense-form-page.client.tsx`
- `src/presentation/expenses/participant-selector.tsx`
- `src/presentation/expenses/split-editor.tsx`
- `src/presentation/expenses/expense-allocation-summary.tsx`
- `src/presentation/expenses/receipt-picker.tsx`
- `src/presentation/expenses/receipt-gallery.tsx`
- `src/presentation/expenses/expense-details-page.client.tsx`
- `src/presentation/expenses/expense-activity.tsx`
- `src/presentation/expenses/expense-ui.test.tsx`
- `src/presentation/expenses/expense-form.test.tsx`
- `src/presentation/finance/format-expense-date.ts`
- `src/presentation/finance/format-expense-date.test.ts`

New shared UI primitives only if required by the approved compositions:

- `src/components/ui/checkbox.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/radio-group.tsx`
- `src/components/ui/select.tsx`

Existing files expected to change:

- `src/application/services/application-services.ts`
- `src/application/repositories/index.ts`
- `src/application/index.ts`
- `src/domain/splits/percentage-split.ts` and its tests (draft summary only; final allocation unchanged)
- `src/domain/expenses/expense-financial-fingerprint.ts` and its tests (policy projection only; invariant unchanged)
- `src/infrastructure/indexeddb/atomic-persistence.ts`
- `src/infrastructure/indexeddb/phase-4.integration.test.ts`
- `src/app/_providers/local-application-runtime.client.tsx`
- `src/presentation/runtime/application-runtime-context.tsx`
- `src/presentation/index.ts`
- `src/presentation/shell/mobile-navigation.tsx`
- `src/presentation/shell/navigation.test.tsx`
- `src/architecture/architecture.test.ts`
- `tests/e2e/expenses.spec.ts`
- AIDOS state/plan/lessons documents when implementation evidence or a durable learning changes.

The approved percentage-source requirement now requires an Expense record-version bump and a transactional IndexedDB schema-version migration. The migration preserves every historical allocation exactly and marks percentage records without original basis points as non-reconstructable legacy history; it never invents percentages. No dependency addition is planned.

Additional persistence/application work:

- add split-specific basis-point source entries to modern percentage Expense domain and persistence models;
- validate participant identity, exact 10,000-basis-point total, integer branding, and deterministic regeneration of the persisted allocation;
- expose an explicit legacy-percentage-input-unavailable state to privacy-safe application models;
- prefill modern Edit forms from persisted basis points only, never from poisha allocations;
- allow legacy name/receipt-only changes when the complete financial fingerprint is unchanged and block every legacy financial edit;
- add atomic migration, malformed-record, disagreement, reload, and rollback fixtures.

## Comprehensive test matrix

### Domain and validation

- Strict money: valid whole/one-decimal/two-decimal text; reject empty, whitespace, sign, comma, symbol, exponent, more than two decimals, zero expense, negative, unsafe overflow.
- Date-only: valid Gregorian/leap dates, invalid dates, local date defaults, month extraction at month/year boundaries, and no UTC shift.
- Equal: reordered participants, remainder poisha, amount smaller than participant count, explicit zero-share retention, no/duplicate participants.
- Amount: exact/under/over totals, signed remaining status, blank versus explicit zero, invalid text, reordered participants, overflow.
- Percentage: strict text to basis points, exact/under/over 10,000, zero-basis-point participants, provisional preview, largest remainder, stable-ID ties, reordered inputs, overflow.
- Former-member policy projection and invariant: current-only financial edits allowed; any former involvement freezes every financial field and deletion; name/receipt-only edits preserve the financial fingerprint.

### Application and privacy

- List requires active household membership, excludes deleted by default, returns only current household rows, resolves active/former payer labels, and composes every filter/search/sort combination deterministically.
- Create forces actor as creator/payer, rejects non-household/former/duplicate participants, requires at least one participant, and rejects prepared-allocation bypasses.
- Cash stores neither reference nor private snapshot; Card accepts only the actor's active card; foreign/archived/missing cards fail.
- Owner details receive the historical snapshot; members and leader receive only Card. Serialized leader DTO/error/audit output contains no private metadata.
- Creator/leader/member/non-member edit and delete matrix, including direct service calls that bypass disabled controls.
- Owner preserve/change Card; leader preserve opaque Card, confirm Card -> Cash, reject Card -> Card and Cash -> Card.
- Deleted expense is read-only retained history and cannot be edited/deleted again.
- Confirmed settlement records remain byte-for-byte unchanged across edit/delete while balance calculation reflects permitted source changes.
- Receipt read visibility, editor-only add/delete, tombstone retention, Blob removal, and safe audit history.

### Persistence and atomicity

- Atomic create succeeds with zero/multiple receipts and private snapshot; any duplicate/store/signature failure rolls back expense, snapshot, all receipt metadata/Blobs, and audit.
- Atomic edit updates expense/card snapshot/receipt adds/removals/audits together; injected failure rolls back every store.
- Persisted receipt is an IndexedDB Blob, never base64; JPEG/PNG/WebP signatures and MIME/size agreement; 0 bytes and greater than 10 MiB rejected, 1 byte passes the size-range check but still fails the independent real-image signature check, and a signature-valid 10 MiB fixture is accepted.
- Close/reopen preserves expenses, shares, private owner snapshot, receipt bytes, tombstones, deletion state, and audit order.
- Stale edit/version and membership-change races fail without partial writes.

### Component behavior

- Expenses loading/error/empty/populated/filter-empty states; default query controls; Clear Filters; clickable keyboard row/card; correct public labels and BDT/date formatting.
- Add defaults: payer `You`, Cash, local date, all active members, Newest list default unaffected; no Card reference in Cash state.
- Participant toggles, split-method switches retaining drafts, zero-share display, all live summaries/status text, exact Save gating, first-error focus, duplicate-submit blocking.
- Card picker owner-only states, archived exclusion, no-card handling, and leader opaque-card restrictions.
- Multiple receipt selection, preview/remove, object URL cleanup, unsupported/oversize/read/persistence failures preserving form state, accessible controls.
- Details owner/leader/member action variants, individual shares, receipts/viewer errors, audit timeline, Deleted/former-history messaging, destructive confirmation focus and error behavior.
- Expense details/edit routes keep Expenses active in mobile navigation while `/expenses/new` keeps the distinct Add state.
- Mobile targets, no horizontal overflow, bottom-nav clearance, tablet reflow, desktop sticky summary, reduced motion, and zero serious/critical Axe findings.

### Playwright journeys

- Raiyan creates Cash expenses using Equal, Amount, and Percentage splits; reload proves list/details persistence and exact displayed shares.
- Owner creates a Card expense and sees snapshot; another member and leader see only `Payment Method: Card` and no private strings/IDs in DOM or application-visible state.
- Leader edits another member's Card expense by preserving it, then separately confirms Card -> Cash; forbidden transitions remain unavailable and fail at service level.
- Normal member can open details but cannot edit/delete; creator and leader can; explicit delete removes the item from list after reload while retained history/integration assertions remain.
- Real JPEG/PNG/WebP uploads preview, save, reload, open, and authorized delete; failed invalid receipt leaves the form populated.
- Search/month/payer/payment/sort composition, including expense-date versus createdAt ordering and same-date deterministic ties.
- Current/former-member protection journey and immutable confirmed-settlement integration assertion.
- 390x844 mobile, 768px tablet, 1024px laptop, and 1440x900 desktop checks; keyboard-only form/dialog/gallery flow; Axe and console/page/hydration checks.

### Exit verification

- Focused and full Vitest, architecture guard, lint, TypeScript, production build, full Playwright Chromium suite, native IndexedDB reload checks, dependency audit, `git diff --check`, responsive screenshots, and manual private-data/UTC/date-only source audits.

## Risks and approval decisions

1. **Unbounded receipt count:** there is no business count cap, but implementation must avoid eager full-collection loading, revoke object URLs promptly, avoid base64 and unnecessary copies, process incrementally where practical, and preserve drafts on quota/persistence failure. Any necessary future cap must be proposed rather than silently added.
2. **Seeded receipt visual:** the Phase 4 seed contains a signature-valid header-only PNG suitable for persistence tests but not a reliable visual image. Keep the accepted seed stable; use real uploaded fixtures for Phase 7 preview/viewer verification.
3. **Activity detail:** existing audit events store action, actor, time, and changed field names but not old/new financial values. Phase 7 will show supported safe history and will not invent or backfill sensitive snapshots.

## Phase entry and exit gates

Entry after approval: clean Phase 6 baseline at `f5719b9`, frozen requirements reread, and this plan marked authorized.

Exit: all listed Phase 7 screens and workflows implemented; all financial, privacy, former-member, receipt, persistence, responsive, and accessibility checks pass; AIDOS evidence is updated; no Phase 8+ behavior is introduced; user reviews the completed phase before the Phase 7 implementation commit.

## Implementation result

Completed and verified on 2026-08-18. The implementation remains intentionally uncommitted for user review. Expense/receipt scope, the approved v2 percentage-source migration, privacy and permission boundaries, former-member/legacy protections, responsive behavior, and accessibility checks are green. Full evidence is recorded in `ACTIVE_PLAN.md` and `PROJECT_STATE.md`. Phase 8 was not started.
