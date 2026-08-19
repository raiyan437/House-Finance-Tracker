# Phase 10 Plan — Household Management and Leadership

## Status and authorization

Phase 9 is accepted and committed as `d96451e`. Phase 10 implementation was explicitly approved on 2026-08-19 with all decisions and clarifications in this document frozen. Phase 10 is now implemented and verified, and remains intentionally uncommitted for review. Phase 11 and later phases remain unauthorized.

## Objective and exit outcome

Complete `/household` beyond the Phase 6 onboarding flow so an active member can understand the household and use only the management actions allowed by their current role:

```text
Household
├── identity and existing House Code
├── current Leader
├── active Members
├── Pending join requests                 Leader only
└── management
    ├── Leave Household                   eligible member only
    ├── Remove Member                     Leader only
    ├── Transfer Leadership               Leader only
    └── Delete Household                  Leader only
```

Exit requires a presentation-safe Household page, reuse of the Phase 6 request flow, authoritative transaction-time role and financial revalidation, exact historical-retention semantics, immediate cross-identity reconstruction, complete responsive/accessibility behavior, and the full Phase 2–9 regression suite remaining green.

## Exact scope

- Preserve the Phase 6 `no-household`, `pending-request`, `active-member`, and `active-leader` states and the existing Create, Join, Cancel, Accept, and Reject workflows.
- Replace the sparse active Household view with the Household name, masked-by-default nine-digit code, Show/Hide and Copy controls, current Leader, and all current active members.
- Show deterministic initials, display name, and visible role text/badge. Show current-user context without relying on color.
- Keep the existing leader-only Pending join-request section and route its Accept/Reject actions through the same application and atomic-persistence operations introduced in Phase 6.
- Add a normal-member Leave Household workflow with exact zero-balance and no-Pending-settlement gates.
- Explain every Leave blocker, distinguishing owes, is owed, outgoing Pending, incoming Pending, leader-transfer-required, and sole-leader-delete-required states.
- Add leader-only contextual actions for another active non-leader member: Remove Member and Transfer Leadership.
- Gate Remove Member on target role/status, exact zero balance, and no Pending settlement involving the target.
- Allow Transfer Leadership to another active member without balance or settlement gates, while preserving exactly one active Leader atomically.
- Add leader-only Household deletion with full-ledger zero-balance and household-wide no-Pending-settlement gates plus explicit destructive confirmation.
- Retain former memberships and all historical Expenses, Settlements, Receipts, and audits without granting former members ongoing Household-route access.
- Leave private Cards and private Expense Card snapshots untouched and owner-private through every Household mutation.
- Reconstruct authoritative session, membership, role, permissions, balances, badges, and route state after every mutation and development identity switch.
- Strengthen existing Phase 6 Accept/Reject persistence so the acting Leader and active Household are also revalidated in the same transaction.
- Return a typed stale/conflict failure when transaction-time state no longer matches a preview, then refresh the authoritative UI before further action.

## Explicit exclusions

- Dashboard, analytics, Monthly Reports, or any Phase 11 work.
- Appwrite, production authentication, email/password flows, or cross-device synchronization.
- House Code editing, rotation, regeneration, reuse, or expiration.
- Household name editing/renaming UI; Phase 10 displays the current name only.
- Multiple households, household switching, restoring deleted households, or reopening former membership.
- Roles beyond Leader and Member; no administrator, owner, moderator, or custom permissions.
- Email invitations, contact discovery, notifications, reminders, or bulk member administration.
- Member profile editing, external avatar images, or broad member financial dashboards.
- Arbitrary settlement creation, settlement lifecycle override, balance forgiveness, or leader bypasses.
- Physical deletion of memberships, Expenses, Settlements, Receipts, audits, Cards, or House Codes.
- Former-member access to active Household, Expense, Settlement, or Receipt routes solely because historical records reference them.
- A broad audit/history screen or private Card lifecycle entries in Household audit data.
- DEV identity controls inside product UI.

## Frozen House Code behavior

- The stored value remains an exact nine-character ASCII-digit string.
- Leading zeroes remain intact in storage, projection, display, and clipboard text.
- The code remains globally unique through the existing IndexedDB unique index.
- A tombstoned Household record remains in the store, so its code stays reserved and cannot be generated or created again.
- The active Household page masks the code by default with nine bullets. **Show** toggles only ephemeral React state; **Hide** restores masking. **Copy** copies the exact string and announces success without changing persistence.
- Code visibility resets to hidden when the viewer identity or Household changes. There is no rotate/edit action.

## Household page state and component hierarchy

```text
src/app/(product)/household/page.tsx                 thin Server Component
└── HouseholdPageClient                             access-state switch
    ├── PageHeader
    ├── HouseholdLoadingState / HouseholdErrorState
    ├── NoHouseholdState                            existing Create / Join
    ├── PendingRequestState                         existing Cancel flow
    └── ActiveHouseholdView                         keyed by viewer + household
        ├── HouseholdIdentitySection
        │   ├── Household name
        │   └── HouseCodeControls                   masked / Show / Hide / Copy
        ├── HouseholdLeaderSection
        │   └── MemberIdentity
        ├── HouseholdMemberList                     semantic active-member list
        │   └── HouseholdMemberRow[]
        │       ├── initials + display name + role text
        │       └── MemberActionsMenu               Leader, non-self targets only
        │           ├── Transfer Leadership
        │           └── Remove Member
        ├── JoinRequestsSection                     existing Leader-only flow
        │   └── PendingJoinRequestRow[]             existing Accept / Reject
        └── HouseholdManagementSection
            ├── LeaveHouseholdAction                all active viewers, explained gates
            └── DangerZone                          Leader only
                └── DeleteHouseholdAction

dialogs
├── TransferLeadershipDialog
├── RemoveMemberDialog
├── LeaveHouseholdDialog
└── DeleteHouseholdDialog
```

The active page stays an airy sequence of Soft Premium Finance surfaces. It is not a dense administrator dashboard. Reuse `PageContainer`, `PageHeader`, `Surface`, `Button`, `StatusBadge`, deterministic member initials, the existing Radix-backed menu/dialog primitives, Sonner, and established loading/error patterns.

## Presentation-safe Household models

React receives an application projection, not repositories, IndexedDB records, raw domain records, or broad audit data:

```text
ActiveHouseholdPageView
  household: { householdId, name, code }
  viewer: { memberId, role }
  leader: HouseholdMemberView
  members: HouseholdMemberView[]                    active only
  leave: HouseholdActionPreview
  leaderManagement?:                               absent for normal members
    joinRequests: LeaderJoinRequestView[]
    deleteHousehold: HouseholdActionPreview

HouseholdMemberView
  memberId                                          opaque action key, never rendered
  displayName
  initials
  role: leader | member
  roleLabel: Leader | Member
  isCurrentUser
  leaderActions?:                                   only for Leader viewing another member
    remove: HouseholdActionPreview
    canTransferLeadership: true

HouseholdActionPreview
  eligible
  blockers[]: { code, message, amountPoisha? }
  confirmation: { title, description, confirmLabel }
```

- The `active-member` and `active-leader` access-state union remains the top-level permission boundary. Leader-only request and management data is absent—not merely visually hidden—from a normal member projection.
- Member projection contains active memberships only. Former members remain in persistence and ledger reconstruction but are omitted from the active list and action menus.
- Opaque Household/member/request identifiers appear in React only where an action needs them and are never printed as product content.
- No model contains Cards, private Card snapshots, receipt bytes, email addresses, broad audits, persisted eligibility flags, cached balances, or another Household’s data.

## Member-list behavior

- Show exactly the current active membership set from authoritative persistence.
- Sort the Leader first, then Members by display name using deterministic code-point comparison, then stable member ID as the final tie-break. Do not use locale-sensitive ordering as a financial or identity invariant.
- Render each row as a semantic list item with initials/avatar, display name, and explicit `Leader` or `Member` text. Add `You` for the current viewer where useful.
- Long names wrap without displacing role text or menu access. Duplicate display names remain valid; action accessible names include enough row context to distinguish them.
- Only an active Leader sees a contextual menu, and only on another active non-leader row. The menu contains Transfer Leadership and Remove Member; it never contains private Card, settlement override, or financial-history actions.
- A former member disappears from the active list immediately after authoritative reconstruction but remains in historical membership and financial calculations.

## Application services and use cases

Create a focused Household page projection module and reshape the preliminary Phase 4 methods into explicit current-actor use cases:

1. `getCurrentAccessState()` / `getCurrentHouseholdPage()`
   - Preserve Phase 6 no-Household and Pending privacy projections.
   - For an active membership, load the non-deleted Household, complete membership history, current profiles for active members, non-deleted/retained Expense history, and Settlement history.
   - Derive the Phase 3 balance sheet from non-deleted Expenses plus Confirmed settlements only.
   - Return the role-shaped active page view and action previews. Persist none of the previews, balances, blockers, permissions, or badge counts.

2. `acceptJoinRequest(joinRequestId)` and `rejectJoinRequest(joinRequestId)`
   - Keep the Phase 6 public actions and UI; do not create new request services or records.
   - Pass current actor and resolution time to strengthened named atomic operations.
   - Recheck request Pending status, non-deleted Household, actor’s active Leader role, and—on acceptance—the requester’s lack of active membership in the transaction.

3. `leaveCurrentHousehold()`
   - Derive actor and active Household from the current session; React does not submit an actor or arbitrary Household ID.
   - Use a preview only for explanation and confirmation.
   - Delegate the final decision and mutation to a named atomic leave operation that rebuilds the current ledger and checks all rules before converting only the actor’s active membership to former.

4. `removeMember(targetMemberId)`
   - Derive actor and Household from the current session and treat foreign/missing/inactive targets as not found/forbidden without enumeration.
   - Delegate to a named atomic removal operation that rechecks active Leader authority, target status/role, target exact balance, and target Pending involvement before retaining the target as former.

5. `transferLeadership(targetMemberId)`
   - Derive actor and Household from session.
   - Recheck in one transaction that the Household is active, actor is the sole active Leader, target is another active Member, and the complete persisted membership set has exactly one active Leader before mutation.
   - Atomically change old Leader to Member and target to Leader, validate exactly one active Leader after the change, and append an audit event. Do not load balances or settlements because they do not gate transfer.

6. `deleteCurrentHousehold()`
   - Derive actor and active Household from session.
   - Delegate all final authorization, ledger reconstruction, join-request closure, membership deactivation, tombstoning, and audits to one named atomic deletion operation.

7. `refresh()` / runtime reconstruction
   - Continue the Phase 6 pattern: persist first, reconstruct current session and Household state, derive role/permissions/balances, then render or navigate.
   - Do not manually splice member rows, roles, request counts, or access state in React.

## Balance and Pending-settlement gates

The authoritative ledger is always recalculated from source records:

```text
all retained Household memberships
+ non-deleted Expenses
+ Confirmed settlements
-> Phase 3 exact-poisha balance sheet
```

Pending, Rejected, and Cancelled settlements never affect balances. Pending status is checked separately from the complete Settlement history. No balance, eligibility, or Pending-participation flag is persisted.

- Leave: the actor’s exact balance must equal `0` and no Pending settlement may have the actor as sender or receiver.
- Remove: the target’s exact balance must equal `0` and no Pending settlement may have the target as sender or receiver.
- Delete: every balance entry, including a relevant former member’s retained ledger position, must equal `0`, and no Household settlement may be Pending.
- Transfer: no balance or Pending-settlement gate.

For explanations, the established sign convention is positive = is owed and negative = owes. UI formatting uses the exact absolute poisha amount:

- negative: `You currently owe ৳850. Settle your outstanding balance before leaving.`
- positive: `You are currently owed ৳850. Settle the outstanding balance before leaving.`
- outgoing Pending: `A payment you marked as paid is still pending.`
- incoming Pending: `A payment to you is still pending.`

If multiple blockers exist, show all concise reasons in a semantic list. A disabled trigger is only a preview; the application/domain operation remains authoritative.

## Leave Household workflow

1. Show Leave Household in the management section for every active viewer.
2. For an eligible normal member, open an explicit confirmation explaining loss of active access and retention of financial history.
3. For a blocked member, keep the action unavailable and place the exact explanation adjacent to it; do not rely on a tooltip.
4. A Leader with other active members receives balance/Pending reasons plus `Transfer leadership before leaving.` as applicable. Transfer is never automatic.
5. A sole active Leader receives `Delete the household to leave it.` as applicable. Leave never redirects into or silently invokes deletion.
6. On confirmation, the atomic operation revalidates Household, membership, exact balance, and both Pending directions, then changes only that membership to `former` and appends a membership audit.
7. On success, runtime reconstruction returns `no-household`, Household-dependent route guards apply, and the user may later Create or Join another Household.
8. On stale state, commit nothing, return typed `HOUSEHOLD_STATE_CHANGED`, reconstruct, and display the current blocker.

## Remove Member workflow

1. Only the current active Leader sees Remove Member for another active Member.
2. The preview states whether removal is eligible and explains exact non-zero balance and/or Pending involvement.
3. Confirmation names the target and states that active access ends while historical financial records remain.
4. The transaction revalidates non-deleted Household, current Leader authority, target active Member status, non-self/non-Leader target, current exact balance, and no Pending settlement involving the target.
5. Success changes only the target membership status to `former`, preserves its last role, and appends a membership audit.
6. The target reconstructs to `no-household` on its next identity/session reconstruction. The Leader’s page reconstructs without that active row.
7. Any race returns `HOUSEHOLD_STATE_CHANGED`, commits nothing, refreshes the page, and requires a fresh confirmation if still eligible.

## Transfer Leadership workflow

1. Only the active Leader sees Transfer Leadership for another active Member.
2. Confirmation names the target and explicitly states both consequences: target becomes Leader; actor remains a normal Member.
3. The transaction reads the authoritative Household and complete membership set, rejects deleted Household, wrong actor, self, inactive/former target, or changed roles, and verifies the exactly-one-active-Leader invariant.
4. In one transaction, old Leader becomes active Member, target becomes active Leader, and an audit event is appended.
5. No balance or Pending settlement is read as an eligibility condition.
6. Authoritative reconstruction removes Leader controls from the old Leader immediately. Switching DEV identity to the new Leader reconstructs the Leader-only request and management data.

## Delete Household workflow and final persistence model

### Eligibility and confirmation

- Only the current active Leader may confirm deletion.
- Every retained ledger balance must be exactly zero and no Settlement may be Pending.
- The confirmation names the Household and says the Household closes for all members, historical financial records remain, and the Household cannot be used afterward.
- The confirm label is `Delete Household`; cancel is the default safe action. No typed-name ceremony is introduced unless separately approved.

### Proposed Pending join-request terminal state

Approved decision: extend `JoinRequestStatus` with terminal `household-closed`.

`cancelled` means the requester cancelled; `rejected` means the Leader rejected; neither accurately describes deletion. A Pending request closed by Household deletion therefore becomes:

```text
status = household-closed
resolvedAt = deletion instant
resolvedByUserId = deleting Leader
pendingJoinUserKey = absent
```

Add a backward-compatible `JoinRequestRecordV2` for the extended status while continuing to read existing v1 records. No IndexedDB schema-version increase is required because stores, key paths, and indexes do not change; record version and database schema version remain separate. Existing Accepted, Rejected, and Cancelled requests remain byte-for-byte/domain-value unchanged.

### One authoritative deletion transaction

The named transaction spans `households`, `memberships`, `joinRequests`, `expenses`, `settlements`, and `auditEvents`:

1. Read and validate the current non-deleted Household.
2. Read and reconstruct every Household membership, Expense, Settlement, and join request from persisted records.
3. Recheck actor active-Leader authority.
4. Recalculate the exact Phase 3 ledger from non-deleted Expenses and Confirmed settlements and verify every balance is zero.
5. Verify no Settlement is Pending.
6. Tombstone the Household with `deletedAt`, `deletedByUserId`, and updated timestamp; never remove the record or code.
7. Convert every active membership to `former`; retain already-former memberships unchanged and preserve each membership’s last role as history. A tombstoned Household intentionally has zero active Leaders and cannot be reconstructed as active.
8. Transition every Pending join request to `household-closed`; leave all terminal requests unchanged.
9. Append one Household deletion audit plus one sanitized join-request closure audit per transitioned request.
10. Commit all changes together, or roll back every write.

The transaction deliberately does not write the financial/evidence/private stores:

| Resource | Deletion result |
|---|---|
| Household | Tombstoned; name/code/history retained; code remains reserved |
| Active memberships | Become former; active uniqueness keys released |
| Existing former memberships | Unchanged |
| Pending join requests | Become `household-closed`; Pending uniqueness keys released |
| Accepted/Rejected/Cancelled requests | Unchanged |
| Expenses, including soft-deleted history | Unchanged |
| Settlements | Unchanged; deletion precondition guarantees none are Pending |
| Receipt metadata and blobs | Unchanged; no physical evidence deletion |
| Cards | Unchanged, neither archived nor deleted; remain owner-private and Household-independent |
| Private Expense Card snapshots | Unchanged and owner-private |
| Existing audits | Unchanged; sanitized deletion/closure events appended |
| User profiles | Unchanged |

`expenses` and `settlements` participate as authoritative read/gate stores, ensuring IndexedDB serializes deletion against overlapping financial writes. Receipt and Card stores are excluded because deletion neither reads nor writes them; before/after tests prove they remain unchanged.

After commit, every former active member and every closed requester reconstructs to `no-household`. Historical retention does not grant access to Household-dependent routes.

## Transaction-time concurrency and typed conflicts

Previews improve UX but never authorize a mutation. Named atomic operations accept intent (current actor, target where applicable, and generated IDs/timestamps), reread source records, run the pure domain policies, and construct committed records inside the transaction.

Use a presentation-safe typed application error such as `HOUSEHOLD_STATE_CHANGED` for a preview/commit mismatch or concurrent role, membership, balance, Pending, request, or deletion change. The client composition layer reconstructs authoritative state even on this typed failure before surfacing concise feedback. No partial optimistic role/member patch is allowed.

Examples covered:

- member appears removable, then a new Expense creates a non-zero balance;
- member appears eligible to leave, then a Pending settlement is created;
- Leader opens Transfer, then leadership changes elsewhere;
- Leader opens Delete, then a financial write or Pending settlement commits;
- Leader opens Accept/Reject, then the request or Leader role changes.

Each case must either serialize before the Household operation and be seen by its reread, or serialize afterward against the committed new state. It must never commit from a stale preview.

## Historical retention and former-member protections

- Leave and Remove only change membership status. Delete changes Household status, active memberships, and Pending request terminal status.
- No operation changes an Expense amount, payer, participants/shares, Expense Date, Payment Method, or deleted state.
- No operation changes confirmed, rejected, or cancelled Settlements, or any Receipt metadata/blob.
- Existing Phase 3/7 financial fingerprint protections continue to block later financial edits involving former members and soft deletion that would alter their settled position.
- Former members remain in membership history so the balance engine can validate retained ledgers, but they are excluded from new Expense participants, settlement creation, active member lists, and product-route authorization.
- Cards remain user-owned across Leave, Remove, Transfer, and Delete and remain usable on `/cards` with no Household.

## Cross-identity and route behavior

```text
persist atomically
-> reconstruct current session and Household access
-> derive role, permissions, balances, request/badge state
-> render or apply route guard
```

- Transfer: old Leader immediately sees Member controls; target sees Leader controls after identity switch/reconstruction.
- Leave/Remove: departed identity becomes `no-household`; historical references do not reopen financial routes.
- Delete: all former members and `household-closed` requesters become `no-household`; `/cards` and `/profile` remain independent.
- Accept: requester becomes active Member through the existing Phase 6 reconstruction path.
- Reject/household closure: requester becomes `no-household` and may Create or Join later.
- Development identity switching remains a separate toolbox and never appears in Household management UI.

## Responsive behavior

- `<640px`: stacked identity, Leader, Members, requests, management, and danger surfaces; member rows wrap; contextual actions use reachable 44px menu triggers; confirmations fit the viewport with safe scrolling and full-width footer actions where useful.
- `640–767px`: retain stacked sections but allow code controls and short row actions to sit inline when readable.
- `768–1023px`: use the existing tablet shell; identity and Leader summary may share space, while member/request lists remain comfortably wide.
- `1024–1279px`: desktop sidebar plus a restrained content column; no dense admin table.
- `1280px+`: keep the established max width and airy spacing; management/danger content remains visually separate from identity/member content.
- Long names, duplicate names, blocker copy, and nine-digit code controls must not create horizontal overflow at supported breakpoints or zoom.

## Accessibility behavior

- Use logical headings and labelled semantic lists for active members and Pending join requests.
- Initials/avatar are decorative or redundantly labelled; display name and role exist as text.
- Show/Hide and Copy have explicit accessible names, visible focus, keyboard activation, and a polite live announcement. Masking is not conveyed by color.
- Contextual menus support Enter/Space, arrows, Escape, outside dismissal, and focus return to the correct member row.
- Dialogs provide programmatic title/description, focus trap, initial focus, Escape/cancel, pending state, inline alert errors, and trigger focus return when the trigger remains.
- Transfer and destructive dialogs state consequences in text. Delete styling is not the only danger signal.
- Disabled/unavailable financial actions have persistent adjacent explanations reachable without hover; eligibility is not color-only.
- Important mobile controls are approximately 44px; reduced motion and visible focus follow the existing system.
- Mutation success uses polite live/toast feedback; failures use alert semantics and never expose raw IDs or private data.
- Axe serious/critical findings must remain zero, with keyboard-only completion of every available workflow.

## Proposed files

### New

- `docs/ai/work/PHASE_10_PLAN.md`
- `src/application/household/household-page.ts`
- `src/application/household/household-page.test.ts`
- `src/presentation/household/house-code-controls.tsx`
- `src/presentation/household/household-member-list.tsx`
- `src/presentation/household/household-member-actions.tsx`
- `src/presentation/household/household-management-dialogs.tsx`
- `tests/e2e/household-management.spec.ts`

### Modify

- `src/presentation/household/household-page.client.tsx`
- `src/presentation/household/household-ui.test.tsx`
- `src/application/services/application-services.ts`
- `src/application/services/application-services.integration.test.ts`
- `src/application/services/household-onboarding.integration.test.ts`
- `src/application/repositories/index.ts`
- `src/application/errors/application-error.ts`
- `src/domain/membership/membership-types.ts`
- `src/domain/membership/membership-eligibility.ts`
- `src/domain/membership/membership-eligibility.test.ts`
- `src/domain/membership/leadership-policy.ts`
- `src/domain/membership/leadership-policy.test.ts`
- `src/domain/records/domain-records.ts`
- `src/infrastructure/indexeddb/records.ts`
- `src/infrastructure/indexeddb/mappers.ts`
- `src/infrastructure/indexeddb/atomic-persistence.ts`
- `src/infrastructure/indexeddb/phase-4.integration.test.ts`
- `src/app/_providers/local-application-runtime.client.tsx`
- `src/presentation/runtime/application-runtime-context.tsx`
- `tests/e2e/household-onboarding.spec.ts`
- relevant route-guard, navigation-badge, Expense, Settlement, Card privacy, and architecture tests
- `docs/ai/PROJECT_RULES.md`
- `docs/ai/PROJECT_STATE.md`
- `docs/ai/REQUIREMENTS.md` only after plan approval, to freeze the approved Phase 10 clarification
- `docs/ai/work/ACTIVE_PLAN.md`
- `docs/ai/AI_LESSONS.md` only for durable implementation discoveries

No Appwrite file, API Route Handler, Server Action, paid dependency, new role system, or financial store is proposed.

## Comprehensive test matrix

| Area | Required coverage |
|---|---|
| Household views | active Leader and Member projections; no-Household and Pending Phase 6 states unchanged; Leader-only data absent from Member projection; deleted Household never active |
| Identity/code | name and current Leader; exact nine ASCII digits; leading-zero display/copy; masked default; Show/Hide; Copy announcement; hide reset on identity/Household change; no rotation/edit |
| Member list | active only; Leader first; deterministic Member ordering; initials; duplicate/long names; Leader/Member text; current-user context; former members absent |
| Join requests | existing Pending list; Accept success; Reject success; confirmation; non-Leader denial; actor-role race; already-terminal race; acceptance active-membership race; no second request implementation |
| Leave success | normal active Member, exact zero balance, no Pending; membership becomes former; active key released; user reconstructs no-Household; may later Create/Join |
| Leave balance gates | owes; is owed; one-poisha non-zero boundary; exact displayed absolute amount; multiple blockers |
| Leave Pending gates | outgoing Pending; incoming Pending; both directions; terminal settlements do not block |
| Leader leave | Leader with others requires transfer; sole Leader requires Delete; balance/Pending reasons compose; no automatic transfer/delete |
| Remove success | Leader removes another active Member at exact zero/no Pending; membership/history retained; target reconstructs no-Household |
| Remove denial | non-Leader actor; self target; Leader target; former/inactive/foreign target; target owes; target is owed; outgoing Pending; incoming Pending |
| Transfer | success; explicit consequence copy; self denied; non-Leader denied; inactive/former/foreign target denied; balance not required; Pending not relevant; exactly one active Leader before/after; atomic rollback |
| Role refresh | old Leader immediately loses controls; target gains controls after switch; request badge/controls follow new Leader; React does not manually patch role |
| Delete success | active Leader; every ledger balance zero including former history; no Pending; tombstone retained; code reserved; every active membership becomes former; no active Leader remains in tombstoned Household |
| Delete denial | non-Leader; actor inactive; any active or former member non-zero; one-poisha boundary; any Pending settlement; terminal settlements allowed; already-deleted Household |
| Join requests on delete | every Pending becomes `household-closed`; resolution metadata set; Pending keys released; prior Accepted/Rejected/Cancelled unchanged; requester reconstructs no-Household; transaction rollback restores all statuses |
| Historical retention | Expenses unchanged; soft-deleted Expenses retained; confirmed/terminal Settlements unchanged; Receipts/blobs unchanged; audits retained plus sanitized events; former-member financial protections remain enforced |
| Cards/privacy | every owner’s Cards unchanged through Leave/Remove/Transfer/Delete; no archive/delete side effect; private Expense snapshots unchanged; Leader/member projections contain no private Card metadata |
| Stale commit protection | new Expense before Leave/Remove/Delete; new Pending before Leave/Remove/Delete; role transfer before any Leader action; target departure before Transfer/Remove; request transition before Accept/Reject; typed conflict and zero partial writes |
| Persistence | fake IndexedDB atomic store coverage; forced abort rollback; v1/v2 join-request read compatibility; `household-closed` close/reopen; native IndexedDB close/reopen; reserved deleted code |
| Cross identity/routes | transfer Raiyan→John; switch both ways; Member Leave; Leader Remove; Delete for all identities; former members blocked from Household-dependent financial routes; Cards/Profile remain available |
| Components | loading/error/empty/Pending/active states; menus; blocker copy; confirmations; busy/error/success; stale refresh; focus trap/return; disappearing trigger after removal/transfer |
| Responsive/accessibility | 390x844, large mobile, tablet, laptop, 1440x900; no overflow; ~44px targets; keyboard-only flows; zoom; reduced motion; semantic lists; live regions; Axe zero serious/critical |
| Regression | full Vitest Phase 2–9 and architecture guards; lint; TypeScript; production build; full Chromium Playwright; dependency audit; `git diff --check`; no console/page/hydration/runtime errors |

## Risks and mitigations

1. **Existing service methods look complete but trust pre-transaction financial context.** Replace their persistence contracts with intent-based named atomic operations that reconstruct and enforce the same pure policies inside the transaction.
2. **Phase 6 request authorization can race leadership transfer.** Add actor and Household checks to the same Accept/Reject transaction; keep the public request flow unchanged.
3. **Tombstoned Households have zero active Leaders, while active Household invariants require exactly one.** Validate exactly one Leader before deletion, then treat zero active Leaders as a deliberate terminal state that is never passed through active-Household reconstruction.
4. **A generic Cancelled request would misstate why a request ended.** Use the explicit terminal `household-closed` state and a sanitized closure audit.
5. **Former members remain necessary for ledger integrity but must not retain product access.** Separate historical persistence from active-membership route authorization and test both directions.
6. **Dialog triggers may disappear after Transfer/Remove.** Let the Radix dialog close on successful persistence, then reconstruct; verify focus lands on a stable section heading or next logical control when the original trigger no longer exists.
7. **A full deletion transaction touches several stores.** Keep it as one named operation, prepare timestamps/IDs before opening it, avoid unrelated async work while active, and force-abort test every write group.

## Approved business decisions

1. **Terminal status for Pending requests when a Household is deleted.** Use `household-closed`, not Cancelled or Rejected. It is produced only by the authoritative deletion operation from Pending, has zero membership/financial effect, records the deletion instant and deleting Leader, and is terminal.
2. **Former membership role after departure/deletion.** Preserve the last role as historical data while status becomes former. Authorization always requires both `status = active` and `role = leader`.
3. **Household rename UI.** Exclude it because the requested management set names Leave, Remove, Transfer, and Delete, while the supplied normal view only displays identity. The existing unsurfaced service is not authorization to add UI.
4. **Post-departure historical viewing.** Resolved by the request: no active membership means no Household-dependent route access. Historical records are retained for integrity, not exposed through a new former-member portal.
5. **Delete confirmation strength.** Use one explicit alert dialog with the Household name, preservation consequences, and destructive label. No typed-name confirmation is required.

No other business rule is left open by this plan. Stop during implementation if a new rule would alter financial history, membership authority, privacy, or deletion semantics.

## Recommended model and reasoning level

Use **GPT-5.6 Sol (`gpt-5.6-sol`) with high reasoning** for Phase 10 implementation. This phase combines exact financial gates, multi-store IndexedDB serialization, destructive-looking lifecycle changes, privacy, authorization, and cross-identity UI reconstruction. Use `xhigh` for the final transaction/adversarial review if stale-state testing reveals ambiguity; `max` is unnecessary unless a concrete concurrency defect resists diagnosis. **GPT-5.6 Terra with high reasoning** is the cost-balanced fallback after the plan and transaction contracts are frozen.

## Entry and exit gates

Entry:

- Explicit user approval of this Phase 10 plan and the five recommended decisions above.
- Re-read AIDOS documents and relevant bundled Next.js guidance before implementation.
- Confirm the worktree contains only the approved Phase 10 planning changes after `d96451e`.
- Add the approved Phase 10 decisions to `REQUIREMENTS.md` before product-code implementation.

Exit:

- Complete active Household identity/member/request/management UI without redesigning the product.
- Leave, Remove, Transfer, Delete, and Phase 6 request operations pass transaction-time role/state/financial checks and atomic rollback coverage.
- Deleted-Household, membership, Pending-request, history, private-Card, and route semantics match this approved model.
- Full unit, integration, component, native persistence, responsive, accessibility, Playwright, and Phase 2–9 regression matrix is green.
- AIDOS state/plan/lessons contain verified evidence.
- Stop for Phase 10 review; do not begin Phase 11.
