# Phase 8 Plan — Settlement Workflows

## Status and authorization

Phase 7 is accepted and committed as `ff5a878`. Phase 8 implementation was explicitly approved on 2026-08-18 with the clarifications recorded below. Implementation is limited to this phase; Phase 9 remains unauthorized.

## Objective and exit outcome

Deliver the complete local Settlements experience on `/settlements` using the existing Phase 3 balance, recommendation, lifecycle, staleness, duplicate-Pending, and permission rules plus the existing Phase 4 IndexedDB repositories and named atomic settlement operations.

The completed flow will be:

```text
derive current position
  -> show current-user recommendations
  -> sender records an exact recommended external payment
  -> Pending claim has no balance effect
  -> receiver confirms or rejects, or sender cancels
  -> Confirmed original amount affects freshly derived balances
```

House Finance Tracker records claims about payments made outside the application. It never transfers money.

Exit requires all Phase 8 unit, integration, component, and Playwright scenarios below to pass, all Phase 2–7 tests to remain green, and no open financial-integrity, authorization, responsive, accessibility, hydration, page, or console defect.

## Exact scope

- Replace the `/settlements` placeholder with the complete household-only Settlements page.
- Show two always-present current-user summary cards: **You Owe** and **You Are Owed**.
- Derive the current household balance sheet from non-deleted expenses plus Confirmed settlements only.
- Derive recommendations exclusively with the existing deterministic Phase 3 largest-debtor/largest-creditor engine and stable-ID tie-breaking.
- Show only recommendations involving the current user:
  - outgoing: `You owe {member}` with the exact full amount and **Settle Up** action;
  - incoming: `{member} owes you` with the exact full amount and no action owned by the current user.
- Prevent a Settle Up action when an unordered-pair Pending claim already exists; explain that the existing Pending claim must be resolved instead.
- Open an accessible confirmation dialog that states no money is transferred and asks the sender to confirm the exact external payment before **Mark as Paid**.
- Create an immutable-amount Pending settlement snapshot through the existing application/domain policy and atomic settlement-plus-audit persistence operation.
- Show active Pending claims involving the current user:
  - receiver: `{sender} says they paid you`, with **Reject** and **Confirm Received**;
  - sender: `Waiting for {receiver} to confirm`, with **Cancel Payment Claim**;
  - no actions for an unrelated actor, including a household leader.
- Reassess Pending staleness with the Phase 3 function and translate `amount-changed`, `recommendation-absent`, and `direction-reversed` into plain-language warnings.
- Preserve the original Pending amount through confirmation, including stale overpayment that creates a reverse balance.
- Show terminal Confirmed, Rejected, and Cancelled household settlement history with parties, exact amount, textual status, creation time, and resolution time.
- Refresh the page projection and navigation action badge from persisted source records after every successful mutation and on DEV identity switch.
- Add a Settlements navigation badge for the current user's actionable incoming Pending confirmations. Sender waiting claims do not increment the action badge.
- Preserve the Soft Premium Finance visual language, established shell, development identity switcher separation, and mobile bottom navigation.

## Explicit exclusions

- Dashboard financial UI or Dashboard settlement modules.
- Card management or any change to Phase 7 Card privacy behavior.
- Full Household management.
- Monthly Reports, analytics, exports, or historical month snapshots.
- Appwrite, real authentication, server persistence, or production authorization adapters.
- Partial settlements, arbitrary amount entry, arbitrary receiver selection, or arbitrary direction selection.
- Payment processing, banking integrations, gateways, money transfer, or payment verification.
- Notifications, reminders, email, push, or background synchronization.
- Settlement editing, amount correction, physical deletion, or deletion of Confirmed history.
- A second balance or recommendation algorithm, pairwise gross-obligation tracking, or a claim of mathematically minimum transfer count.
- Persisted member balances, outstanding totals, recommendations, staleness, summary values, or navigation badge counts.
- Database schema/record-version migration unless implementation uncovers a proven incompatibility in the existing settlement V1 record.

## Architecture and data flow

The dependency direction remains:

```text
Next route / React presentation
  -> settlement runtime actions
  -> SettlementApplicationService and application projector
  -> existing Phase 3 domain engines and repository ports
  -> existing IndexedDB repositories / named atomic operations
```

The Next.js 16 App Router page remains a thin Server Component. Because the approved local runtime and IndexedDB exist only in the browser, the interactive page is a synchronous Client Component under the existing client-only runtime provider. Phase 8 adds no Route Handler or Server Action.

After a mutation:

```text
atomic settlement + audit write
  -> reconstruct current runtime/session shell state
  -> reload persisted memberships, active expenses, and settlements
  -> calculate balances
  -> generate recommendations
  -> project current-user view
  -> render and announce result
```

## Route and component hierarchy

```text
src/app/(product)/layout.tsx                         existing shell/access gate
└── src/app/(product)/settlements/page.tsx          thin Server Component
    └── SettlementsPageClient                       loading/error/reload orchestration
        ├── PageHeader                              title and current-state description
        ├── SettlementSummary                       You Owe / You Are Owed cards
        ├── SettlementRecommendations               current-user incoming/outgoing cards
        │   └── MarkPaidDialog                      disclosure + exact amount
        ├── PendingSettlements                      current-user active claims
        │   ├── PendingSettlementCard
        │   ├── ConfirmReceivedDialog               fresh stale preview + original amount
        │   ├── RejectSettlementDialog
        │   └── CancelSettlementDialog
        ├── SettlementHistory                       terminal history
        │   ├── desktop semantic table/list
        │   └── mobile readable cards
        └── aria-live mutation feedback
```

Use established `PageContainer`, `PageHeader`, `Surface`, `MetricCard`, `MoneyValue`, `StatusBadge`, `Button`, `ConfirmDialog`/Radix dialog primitives, and Sonner infrastructure. Extend the confirmation primitive only if fresh asynchronous confirmation preview and tailored action errors cannot be expressed accessibly through its current contract.

## Application service and use-case changes

Extend `SettlementApplicationService` with explicit use cases rather than moving rules into React:

1. `getSettlementPage(householdId)`
   - Requires the current actor to be an active household member.
   - Loads membership history, active/non-deleted expenses, all household settlements, and member profiles.
   - Calls `calculateHouseholdBalances`, then `generateSettlementRecommendations` exactly once for that source snapshot.
   - Calls `assessSettlementStaleness` for each relevant Pending claim.
   - Returns one presentation-safe `SettlementPageView`.

2. `getPendingSettlementActionPreview(settlementId)`
   - Reloads the Pending record and fresh financial context immediately before confirmation UI.
   - Revalidates active membership and actor relationship.
   - Returns original amount, allowed actor actions, and translated warning data derived from the current Phase 3 staleness result.
   - Never blocks confirmation merely because a claim is stale.

3. `createSettlement(recommendation)` / runtime name `markRecommendationPaid`
   - Retains the current service method's exact recommendation command.
   - Reloads current financial context immediately before creation.
   - Delegates exact recommendation, active-party, sender-actor, and unordered-pair validation to `createPendingSettlement`.
   - Persists the Pending snapshot and creation audit atomically through `AtomicApplicationPersistence.createSettlement`.
   - Relies on the existing unique `pendingSettlementPairKey` index as the transaction-time race guard for same- or reverse-direction duplicates.

4. Explicit `confirmSettlement`, `rejectSettlement`, and `cancelSettlement` application methods (or narrow wrappers over the existing terminal-status method)
   - Resolve the current actor from the session; the UI never supplies an actor ID.
   - Require active household membership at the application boundary.
   - Delegate receiver/sender and terminal-state enforcement to the existing Phase 3 lifecycle functions.
   - Persist status, `resolvedAt`, and audit history atomically through `AtomicApplicationPersistence.transitionSettlement` with expected status `pending`.
   - Never alter sender, receiver, amount, creation time, or originating recommendation.

5. `countCurrentUserSettlementActions()` for shell badges
   - Counts only Pending claims where the current user is the receiver in their active household.
   - Is a derived query and is never persisted.

The existing repository contracts already supply the necessary settlement, profile, membership, expense, and audit reads. `createSettlement` will be strengthened so its authoritative IndexedDB transaction rereads memberships, expenses, and settlements; derives the current balance sheet and recommendations; revalidates the exact requested sender, receiver, and amount; rechecks the unordered Pending pair; and only then inserts the Pending record and audit event. Any recommendation drift rolls back with a typed conflict. No generic unit of work, new financial repository, or derived-state store is proposed.

## Presentation-safe view models

Add application-owned, readonly projections similar to the accepted Phase 7 expense views:

```text
SettlementPageView
  currentUser { userId, displayName }
  summary { youOwe, youAreOwed }
  recommendations[]
    recommendation { householdId, senderId, receiverId, amount }
    counterparty { userId, displayName, former }
    direction: outgoing | incoming
    statement
    canMarkPaid
    blockedReason?
  pending[]
    settlementId, amount, createdAt
    sender { userId, displayName, former }
    receiver { userId, displayName, former }
    relationship: sender | receiver
    statement
    allowedActions { confirm, reject, cancel }
    warning? { heading, detail }
  history[]
    settlementId, amount, status, createdAt, resolvedAt
    sender { userId, displayName, former }
    receiver { userId, displayName, former }
  actionablePendingCount
```

React receives no repositories, IndexedDB records, membership collection, raw audit events, persisted recommendation snapshots, private Card data, or ability flags calculated from component-local ID comparisons. Amounts remain branded integer poisha until `MoneyValue`/`formatBdt` renders them. The application projection translates staleness into safe user-facing warning text while preserving the domain status internally for tests and diagnostics outside normal UI copy.

## Balance and recommendation derivation

For the active household, load:

- the complete current/former membership history required to validate historical ledger parties;
- `ExpenseRepository.listActiveForBalances`, which returns non-deleted expenses only;
- all settlement records.

Then call:

```text
calculateHouseholdBalances(
  householdId,
  memberships,
  activeExpenses.map(toBalanceExpense),
  settlements,
)
```

The domain engine ignores Pending, Rejected, and Cancelled settlements and applies only Confirmed settlements. Positive means the member is owed money; negative means the member owes money; zero means settled. The current-user summary is:

- `youOwe = abs(balance)` only when current balance is negative, otherwise zero;
- `youAreOwed = balance` only when current balance is positive, otherwise zero.

No selected month participates. Nothing derived is written to persistence.

Pass the resulting sheet to `generateSettlementRecommendations`. Preserve its largest-debtor/largest-creditor matching and stable member-ID tie-breaking. Filter the returned recommendations to records where the current user is sender or receiver. React performs no sorting by financial magnitude, recomputation, netting, or recommendation creation.

## Pending, stale, duplicate, and lifecycle presentation

### Pending states

- Receiver: `{Sender} says they paid you`; show original amount, received-payment question, **Reject**, and **Confirm Received**.
- Sender: `Waiting for {Receiver} to confirm`; show original amount and **Cancel Payment Claim**.
- Unrelated Pending claims are not shown in the current-user active Pending section. They remain persisted and continue to enforce household/pair rules.
- Pending stays visible even when current recommendations are empty or the current derived balance is zero.

### Stale warnings

- `current`: no warning.
- `amount-changed`: “Your household balance has changed since this payment was recorded. Confirming will still record the original {amount} payment.”
- `recommendation-absent`: “This payment is no longer part of the current settlement plan. Confirming will still record the original {amount} payment.”
- `direction-reversed`: “Your household balance now points in the other direction. Confirming will still record the original {amount} payment and may create a new amount to settle.”

The confirmation preview refreshes staleness before showing the final Confirm action. Staleness never edits, cancels, caps, or blocks the claim.

### Duplicate Pending behavior

If a recommendation's unordered pair already has a Pending record, keep the financial recommendation visible but replace/disable Settle Up with plain text directing the user to the existing Pending claim. The application policy and unique IndexedDB pair key remain authoritative if a stale UI or second tab still attempts creation. Same-direction and reverse-direction duplicates receive a specific, non-sensitive conflict message and leave the first claim unchanged.

### Lifecycle and balance effects

| Status | Actor/action | Balance effect | Mutability |
|---|---|---:|---|
| Pending | sender created claim | 0 | receiver confirm/reject; sender cancel |
| Confirmed | receiver confirms | original exact amount | immutable |
| Rejected | receiver rejects | 0 | terminal |
| Cancelled | sender cancels | 0 | terminal |

Leaders receive no override. Terminal transitions are blocked in both domain/application calls and the atomic expected-status write. Confirming a stale overpayment applies the original amount and may validly reverse balances.

## Settlement History design

- Show terminal Confirmed, Rejected, and Cancelled household records; do not duplicate Pending records in History.
- Sort newest resolution first, then creation time, then stable settlement ID for deterministic ties.
- Desktop uses a spacious semantic table or aligned list with columns for parties, amount, status, created, and resolved; avoid dense accounting styling.
- Mobile uses one card per record with labels instead of squeezing the desktop table.
- Use `MoneyValue`, tabular numerals, textual `StatusBadge` labels, and semantic `<time dateTime>` elements. ISO instants render in the viewer/browser local timezone with English formatting; no household timezone is assumed.
- Label former members without changing their historical identities.
- Do not surface raw originating-recommendation snapshots because the original parties and amount already provide the user benefit.

## Cross-identity and refresh behavior

- DEV identity switching remains in the existing separate toolbox and is never embedded in the Settlements page.
- Session subscription reconstructs the shell and causes the page to request a projection for the new current actor.
- Settlement mutations use the runtime action adapter, wait for the atomic write, reconstruct shell state/badge count, and reload the page view.
- The UI does not optimistically change balances before persistence succeeds.
- Required journey: Raiyan marks an exact recommendation paid, John sees an incoming Pending claim, John confirms, Raiyan sees fresh balances and recommendations after switching back.
- Equivalent cross-identity journeys cover reject, sender cancel, stale confirmation, and duplicate Pending protection.

## Responsive strategy

- `<640px`: one-column page; summary cards stacked; recommendation/Pending/history cards; primary actions full width where useful; paired receiver actions wrap or use a two-column button row only when both retain 44px targets; no desktop table in the accessibility tree.
- `640–767px`: summary may become two columns when content remains readable; action cards remain touch-first.
- `768–1023px`: two summary cards; comfortable card grids; mobile bottom navigation remains authoritative.
- `1024–1279px`: desktop sidebar plus wider sections; terminal history may switch to the desktop table/list.
- `1280px+`: preserve the existing max-width, spacing, and airy surfaces; do not stretch rows into dense ledger treatment.
- Long names, BDT amounts, warning copy, zoom, and narrow widths must wrap without horizontal overflow.

## Accessibility behavior

- Use ordered heading levels and labelled page sections for summary, recommendations, Pending, and History.
- Amounts are readable text with the BDT symbol and grouping; statuses and staleness are explicit text, never color-only.
- Buttons use actor- and counterparty-specific accessible names such as `Settle up with John for ৳1,250.00` and `Confirm receipt of ৳1,250.00 from Raiyan`.
- Dialogs have programmatic title/description, contain the no-transfer disclosure or stale warning, trap focus, support Escape where safe, and return focus to the trigger.
- During mutation, relevant controls are disabled, `aria-busy` is exposed, and duplicate submission is prevented.
- Success/failure feedback is announced through a polite live region; validation/authorization conflicts use `role="alert"` without leaking records.
- Pending and stale details remain understandable to screen-reader users without icons.
- Interactive targets are approximately 44px minimum on mobile, with visible focus and full keyboard operation.
- Honor reduced motion and preserve zero serious/critical Axe findings.

## Proposed files

### New

- `docs/ai/work/PHASE_8_PLAN.md`
- `src/application/settlements/settlement-page.ts`
- `src/application/settlements/settlement-page.test.ts`
- `src/presentation/settlements/settlements-page.client.tsx`
- `src/presentation/settlements/settlement-summary.tsx`
- `src/presentation/settlements/settlement-recommendation-card.tsx`
- `src/presentation/settlements/pending-settlement-card.tsx`
- `src/presentation/settlements/settlement-action-dialog.tsx`
- `src/presentation/settlements/settlement-history.tsx`
- `src/presentation/settlements/settlement-ui.test.tsx`
- `tests/e2e/settlements.spec.ts`

### Modify

- `src/app/(product)/settlements/page.tsx`
- `src/application/services/application-services.ts`
- `src/application/services/application-services.integration.test.ts`
- `src/presentation/runtime/application-runtime-context.tsx`
- `src/app/_providers/local-application-runtime.client.tsx`
- `src/presentation/shell/desktop-sidebar.tsx`
- `src/presentation/shell/mobile-navigation.tsx`
- `src/presentation/shell/navigation.test.tsx`
- `docs/ai/PROJECT_RULES.md`
- `docs/ai/PROJECT_STATE.md`
- `docs/ai/work/ACTIVE_PLAN.md`
- `docs/ai/AI_LESSONS.md` only if implementation produces a durable new learning

### Expected unchanged

- Phase 3 balance/recommendation/lifecycle/staleness/duplicate-policy algorithms, except for regression tests if a missing edge case is exposed.
- Settlement IndexedDB record shape and database schema version.
- Existing settlement repository and atomic persistence contracts, unless a verified implementation gap requires a separately explained minimal amendment.
- Expense, receipt, and private Card behavior.

## Test matrix

### Domain regression

- Zero-sum sign convention: positive owed, negative owes, zero settled.
- Only Confirmed settlement records affect balances; Pending/Rejected/Cancelled contribute zero.
- Deterministic recommendations and stable-ID ties render in domain order.
- Exact-current full recommendation creation; arbitrary receiver, direction, and amount rejected.
- Unordered-pair duplicate Pending rejection in both directions.
- Receiver-only Confirm/Reject; sender-only Cancel; leader and unrelated actor receive no override.
- Terminal transition blocked; Confirmed identity and amount immutable.
- All four staleness states.
- Stale original-amount confirmation and overpayment/reverse balance.

### Application projection and service integration

- No balance: both summary values zero and all-settled copy.
- Only You Owe; only You Are Owed; both cards always exist.
- Multi-member deterministic incoming/outgoing recommendation statements and ordering.
- Current-user recommendation filtering excludes unrelated edges.
- Settle Up command carries exactly the projected recommendation; forged amount/receiver/direction is rejected by the real service.
- Pending creation returns persisted Pending plus audit and leaves the derived balance/recommendation unchanged.
- Duplicate same/reverse pair is blocked without a second settlement or audit.
- Sender waiting, receiver actions, unrelated actor no actions, and leader no override.
- Confirm, Reject, and Cancel persist correct resolver time and audit atomically.
- Atomic rollback leaves both settlement and audit unchanged on injected failure.
- Terminal retry and Confirmed rewriting are blocked.
- Stale warning projection for amount changed, absent, and reversed direction.
- Confirmation applies original amount even when a new recommendation differs or is absent.
- Soft-deleted expense is excluded and naturally changes position without rewriting settlement history.
- Expense edit naturally changes recommendations and staleness without rewriting the Pending snapshot.
- History contains terminal statuses only, with deterministic ordering and former-member names.
- Close/reopen reconstructs identical settlement history and derived balances from IndexedDB.
- Shell action count includes receiver Pending only and refreshes after every transition/identity switch.

### Component/interaction

- Loading, error/retry, all-settled, empty recommendation, empty Pending, and empty History states.
- Two summary cards and semantic BDT amounts.
- Incoming informational and outgoing actionable recommendation cards.
- No arbitrary party/amount inputs exist.
- No-transfer Mark as Paid dialog copy and exact amount.
- Receiver Confirm/Reject and sender Cancel dialogs; wrong-actor controls absent.
- Stale warning text appears in the card and fresh confirmation dialog without internal enum wording.
- Mutation buttons disable, prevent duplicate activation, announce success/failure, and retain page data on failure.
- Dialog keyboard operation, Escape behavior, focus trap, and trigger focus return.
- Desktop history/table and mobile history cards expose equivalent information.
- Navigation badge accessible label and count behavior.

### Playwright end to end

- No-balance, You Owe, You Are Owed, and multi-member recommendation displays.
- Raiyan -> Mark as Paid -> John -> Confirm -> Raiyan balance/recommendation refresh.
- Receiver Reject journey and sender Cancel journey.
- Pending zero-effect assertion through the rendered summary/recommendations before confirmation.
- Duplicate same-direction and reverse-direction creation blocked through real application/UI flows.
- Wrong actor and leader see no unauthorized action; direct application integration proves authorization is not UI-only.
- Stale amount-changed, recommendation-absent, and direction-reversed warnings after real expense changes.
- Stale confirmation applies the original amount; overpayment creates the expected reverse recommendation.
- Confirmed/Rejected/Cancelled history persists across page reload and browser close/reopen.
- Soft-deleted expense changes derived position appropriately without changing historical settlement fields.
- DEV identity switch reconstructs actor-specific statements, actions, and badge counts.
- Mobile, large-mobile, tablet, laptop, and desktop layouts; no dense mobile table or horizontal overflow.
- Keyboard-only core journeys, dialog focus return, approximately 44px mobile targets, reduced motion, and zero serious/critical Axe findings.
- No hydration mismatch, Next error overlay, uncaught page error, or unexpected console error.

### Full quality gates

- `npm test`
- `npm run test:architecture`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:e2e`
- `git diff --check`
- source audits for no persisted derived state, no React settlement mathematics, no alternative recommendation implementation, and no private Card data in settlement projections

## Implementation sequence after approval

1. Add failing application projection/service tests and define presentation-safe view contracts.
2. Implement page query, fresh confirmation preview, explicit transition use cases, and badge count by composing existing domain/repository operations.
3. Wire settlement actions into the local runtime and shell badge without exposing infrastructure.
4. Build the responsive Settlements page, dialogs, Pending warnings, and terminal History.
5. Add component tests, then cross-identity Playwright workflows and persistence checks.
6. Run the complete regression/quality matrix, perform responsive/accessibility visual review, and update AIDOS state/lessons with actual evidence.

Each step is a smallest coherent vertical slice; no later phase is included.

## Approved clarifications and implementation risks

1. Both summary cards always render, but the frozen signed net position permits at most one non-zero value. No gross-obligation algorithm will be added.
2. Active Pending shows only current-user sender/receiver claims. Terminal History is household-wide and active-member-only.
3. ISO settlement/audit instants render with English formatting in the viewer/browser local timezone. Expense dates remain separate date-only values and are never timezone-shifted.
4. The atomic create operation must close recommendation drift. If IndexedDB cannot keep the required authoritative reads, domain derivation, Pending-pair check, insert, and audit append in one transaction, implementation stops rather than weakening exact-current creation.
5. The navigation badge counts only Pending records where the current user is receiver and must Confirm or Reject. It is always derived.

## Recommended model and reasoning

Use **GPT-5.6 Codex / `gpt-5.6-sol` with high reasoning** for Phase 8 implementation. The work composes already-approved rules, but it spans exact financial derivation, stale temporal state, actor authorization, atomic persistence, cross-identity runtime reconstruction, and responsive/accessibility verification. Use medium reasoning only for narrow mechanical component extraction after the financial/application contracts and tests are fixed.

## Authorization boundary

Phase 8 implementation is authorized with the clarifications above. Stop after Phase 8 implementation and verification; do not begin Phase 9. Leave Phase 8 uncommitted for user review.
