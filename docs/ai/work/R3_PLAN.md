# R3 Plan - Production Financial Commands (Cards -> Expenses -> Settlements)

**Status:** APPROVED for implementation on 2026-08-27. Baseline: R2 checkpoint `9ecd4d3`. R4 remains unauthorized.

## Objective and order

Deliver the frozen production financial workflows through the existing trusted Appwrite command architecture in six ordered slices:

1. **R3A:** additive Schema V4 plus shared financial-command foundations.
2. **R3B:** owner-private Card Create, Edit, and Remove (delete when never referenced; archive when referenced).
3. **R3C:** Expense Create with exact server-derived allocations and private Card snapshots.
4. **R3D:** Expense Edit/Delete with revision OCC and all historical-finance protections.
5. **R3E:** exact-current Settlement Create and receiver/sender lifecycle transitions.
6. **R3F:** the retained real two-account journey, full regression, evidence, and owner-review handoff.

Capabilities enable only after their complete family is green: `cardMutations`, then `expenseMutations`, then `settlementMutations`. Household mutations remain enabled. Receipt mutations and receipt-content reads remain disabled throughout R3.

## Explicit R4 exclusions

No receipt upload, binary read/removal, Storage reservation/quota saga, retention execution, orphan reconciliation, or scheduled worker. Existing receipt metadata and history remain untouched except where the frozen Expense aggregate already requires preservation. R3 does not deploy or go live.

## Schema V4 gate

The only approved live delta is:

- widen required `cards.name` from string capacity 64 to 16,383;
- widen required `expenses.name` from string capacity 64 to 16,383;
- add optional `expense_card_private_details.cardName` string capacity 16,383 with no index;
- write `schema_metadata.active.version = 4` last, only after all resources report available and the full schema verifies.

There is no product maximum for Card, Expense, or Household names: product validation is trimmed, non-empty text. Capacity 16,383 is provider infrastructure. There may be no delete, drop, type change, required-state change, index change, backfill, or second Card/Expense table. Any other live-plan delta stops R3 before apply. If the plan matches exactly, create and verify the external rows backup, apply with readiness barriers, then require a clean post-plan and schema version 4.

## Trusted command architecture

Every mutation follows one path:

`browser intent -> same-origin POST -> HttpOnly session -> server-derived actor -> server Clock -> commandId + SHA-256 canonical intent digest -> Appwrite transaction -> guards/OCC/domain policy -> business rows + approved audit + command outcome atomically -> authoritative read reconstruction`.

R3 extends the proven R2 `runTrustedCommand`, command envelope, transaction runner, guard engine, persistence adapter, error mapping, and production browser runtime. Route Handlers contain transport validation only; they do not duplicate financial rules. The browser never writes Appwrite directly or supplies an authoritative actor, lifecycle instant, allocation, balance, recommendation, or private Card snapshot.

Card lifecycle events do not enter Household audit history and no private Card-audit table is introduced. Command outcomes are retry infrastructure, not presentation audit.

## Command inventory and idempotency

All ten external mutations ledger `{actorId, commandType, commandId, SHA-256 intent digest}` inside the same transaction:

| Family | Command | Route | Atomic outcome |
|---|---|---|---|
| Card | Create | `/api/app/card-create` | original Card result |
| Card | Edit | `/api/app/card-edit` | original edit success |
| Card | Remove | `/api/app/card-remove` | original delete/archive success |
| Expense | Create | `/api/app/expense-create` | original Expense result |
| Expense | Edit | `/api/app/expense-edit` | original revision result |
| Expense | Delete | `/api/app/expense-delete` | original soft-delete result |
| Settlement | Create Pending | `/api/app/settlement-create` | original Settlement result |
| Settlement | Confirm | `/api/app/settlement-confirm` | original terminal success |
| Settlement | Reject | `/api/app/settlement-reject` | original terminal success |
| Settlement | Cancel | `/api/app/settlement-cancel` | original terminal success |

After a commit whose HTTP response is lost, the same command ID and identical intent returns the original sanitized success without another mutation, revision, transition, snapshot, audit, or outcome. Reusing the ID with changed intent returns `IDEMPOTENCY_KEY_REUSED`. Replay reauthenticates and reauthorizes before returning an outcome.

## Serialization and OCC

- Every Expense and Settlement mutation touches `financial:<householdId>` inside its transaction. Household/membership commands that can race financial authorization continue to participate in the same serialization boundary.
- Pending uniqueness acquires `pending-settlement:<householdId>:<collision-safe-unordered-pair>` on create and releases it only on a terminal transition.
- Card create establishes `card:<cardId>`; Card edit/remove and Expense Card selection touch it. An Expense switch from Card A to B touches both guards in deterministic logical-key order.
- Card removal recomputes references in the transaction. Delete-preview drift to Archive is rejected and requires refreshed explicit Archive confirmation.
- Expense Edit/Delete requires exact `expectedRevision`; create starts at revision 1 and successful Edit/Delete increments once. Stale intent returns `EXPENSE_VERSION_CONFLICT` with zero writes. No timestamp-based Expense OCC.
- Card writes reread owner/status/version in-transaction and advance the provider Card version. Foreign, missing, or inaccessible Card IDs collapse to privacy-safe `NOT_FOUND`.
- Settlement transitions reread and require `status = pending`; terminal rows remain immutable.

Appwrite first-committer-wins conflicts compose with these explicit rules. Multiple guard touches use stable ordering. The implementation measures every staged provider operation, including guards, business/private rows, approved audit, and outcome, and stops if any command approaches the verified 100-operation ceiling.

## Card rules and privacy

Cards are Household-independent and visible only to their owner; Leader status grants nothing. Duplicate names and an unlimited product count are allowed. The UI offers the six frozen designs and Debit/Credit. Archived Cards cannot be selected for a new Expense; referenced Cards archive and never-referenced Cards physically delete. A lifecycle edit/archive never changes a historical Expense snapshot.

The browser submits only an opaque selected Card ID. In the Expense transaction the server touches the Card guard, rereads the Card, validates actor ownership and active status, and constructs the private snapshot. New rows store `cardName` separately plus compact `snapshotJson` for remaining frozen design/type metadata. Legacy rows without `cardName` remain readable through the previous JSON representation. Private IDs and Card metadata never appear in non-owner presentation, wire data, logs, or Household audit.

## Expense rules

Create supports name, positive integer-poisha amount, date-only Expense Date, current actor as immutable payer/creator, Cash/Card, selected active participants, and Equal/Amount/Percentage splits. The server uses existing domain allocators to reconstruct and validate canonical shares, remainders, and basis points; browser previews are never authoritative. No floating money or derived-balance persistence is permitted.

The server rejects an Expense Date after the trusted current `Asia/Dhaka` business date. Browser date controls are UX only.

Backdated Create and newly qualifying Edit use a 15-minute HMAC challenge with explicit domain separation `hft:backdated-expense:v1`. The token binds actor, command type, command ID, canonical financial intent digest, Expense Date, qualifying Confirmed Settlement ID and `resolvedAt`, and expiry. A challenge writes no Expense, audit, or completed outcome. On retry the server verifies the token and recomputes the latest qualifying boundary; a newer boundary requires a new warning. The token proves warning presentation only and never grants authorization.

The financial fingerprint includes amount, date, payer, participants, canonical allocations, split method, percentage basis points, payment method, deleted state, and opaque Card association identity. If `expense.createdAt <= latest same-Household Confirmed settlement.resolvedAt`, financial/date changes and Delete are blocked for everyone, including creator and Leader; an otherwise authorized name-only edit remains allowed. Former-member and legacy-percentage locks compose with that rule into one presentation-safe capability without fabricating missing basis points. Expense Delete is soft only and preserves allocations, private snapshot, receipts metadata/history, settlements, and audit.

## Settlement rules

Create reconstructs current balances from non-deleted Expenses plus Confirmed Settlements, derives exact recommendations, and accepts only an exact current sender/receiver/amount recommendation. Arbitrary amounts and parties are rejected. The unordered-pair guard prevents same- or reverse-direction duplicate Pending records.

Pending, Rejected, and Cancelled settlements have zero balance effect. Receiver alone Confirm/Rejects; sender alone Cancels; Leader has no override. Confirmation applies the immutable original Pending amount, not the newest recommendation, so approved overpayment, zero crossing, reverse balance, and a new reverse recommendation remain possible. Confirmed rows are immutable and recommendations/balances are always derived, never persisted.

The shared financial guard serializes Expense Create/Edit/Delete against Settlement Create/Confirm and serializes Settlement lifecycle changes where required. Either side of a race may win, but the later transaction rereads authoritative state and safely fails or recomputes. Covered races include two Expense edits, Expense Edit/Delete versus confirmation, Card archive versus Expense save, membership change versus Expense save, Expense create versus recommendation, and two Pending creates.

## Verification and live acceptance

Automated coverage includes focused Card/Expense/Settlement suites; local/Appwrite parity; transaction rollback; OCC; lost-response replay; changed-intent reuse; forged actor; cross-user and Leader privacy; Card remove/association races; former-member and legacy-percentage cases; future and signed-backdated tampering/new-boundary cases; exact-poisha allocation/property tests; zero-sum and settlement invariants; unordered Pending uniqueness; wrong transition actors; all financial concurrency races; browser reload persistence; architecture guards; full Vitest; ESLint; TypeScript; production build; dependency audit; diff-check; built-client secret audit; Chromium; Firefox/WebKit smoke where supported; and Axe.

The retained live journey uses the existing Leader/Member Household and real approved accounts: Leader creates a private Card; Member cannot see it; Leader creates a Card-paid split Expense; both reload and verify exact balances; owing user creates the exact recommendation; Pending causes zero balance effect after reload; receiver confirms; both reload and verify balance/history; an authorized financial edit of the settled Expense is blocked; a name-only edit succeeds. The resulting history is retained and is not deleted to make tests repeatable. Destructive negative cases use provider-stub integration tests.

## Stop boundary

At R3 completion, update verified release/AIDOS evidence and leave all R3 implementation changes uncommitted for owner review. Do not implement R4 receipts, deploy, merge to `main`, or modify `local-mvp-v1`.
