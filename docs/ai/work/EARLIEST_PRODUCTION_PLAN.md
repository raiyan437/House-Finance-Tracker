# Earliest Safe Production Plan

**Prepared:** 2026-08-26
**Target:** the complete frozen production release defined in `PRODUCTION_RELEASE_PLAN.md`
**Current phase:** R5 — production QA complete; awaiting owner acceptance
**Planning status:** R4 is checkpointed. R5 is implemented and deployed from `feature/phase-13-appwrite`; merge to `main`, final release, and tag remain unauthorized.

## Executive position

The Local MVP remains frozen and thoroughly verified. The complete production composition is live on Appwrite Sites at `https://house-finance-tracker.appwrite.network`: Appwrite authentication, Schema V4 TablesDB reads/mutations, private Receipt Storage through trusted Route Handlers, and the independent maintenance Function. R5 production QA is complete on the feature branch and awaits owner acceptance before merge or release.

The fastest credible route to production is:

1. finish and accept R2 without redesign;
2. implement production Cards, Expenses, and Settlements in dependency order;
3. implement Receipt Storage and scheduled retention;
4. run one consolidated adversarial/release pass on a production-like deployment;
5. launch first on the generated hosting domain, then add a custom domain later if desired.

No local-data migration, self-registration, new product feature, UI redesign, category/budget/export work, or multi-environment synchronization belongs on this path.

## Current reality and immediate blockers

### Already complete

- Frozen Local MVP at tag `local-mvp-v1`.
- Appwrite foundation/auth/session at `bed70e3`.
- R1 production read data plane at `5fed47f`.
- Live Appwrite Schema V3, minimal business data, verified external rows backup/checksum, and verified TablesDB transactions.
- R2 command kernel, coordination guards, idempotency envelope, ten command Route Handlers, and rows-only backup/export/verification tooling checkpointed at `9ecd4d3`.
- Existing CI runs lint, typecheck, Vitest/architecture tests, build, dependency audit, and pull-request whitespace checks.

### R2 acceptance result

1. Restore-script TypeScript mismatch fixed without suppression or unsafe casts.
2. All ten Household mutations use same-origin production command transport; `householdMutations=true` while Expense, Settlement, Card, Receipt, and Profile mutations remain disabled.
3. Create and Rename share trimmed/non-empty validation with no product maximum; 16,383 is Appwrite storage capacity only.
4. Schema V3 is live and clean; external rows backup and checksum verification passed before apply.
5. Two approved accounts passed Create → Pending Join → Accept → active Member with reload persistence. Final live invariants are exactly one Leader, one Member, no pending request, and no duplicates.
6. The complete automated R2 matrix is green. R2 is ready for owner review and R3 has not started.

### R3 acceptance result

1. Planning was checkpointed at `42590b64d9c8ad7c3628dbdd08d94783d298b6a8`; implementation remains uncommitted.
2. Schema V4 is live and clean: Card and Expense name storage capacities are 16,383, the optional private snapshot `cardName` exists, and metadata version is 4. These are provider capacities, not product name limits.
3. Card, Expense, and Settlement production command families are enabled through the trusted R2 architecture. Receipt mutation/content capabilities remain disabled.
4. The existing two-account Household passed the retained private-Card -> exact split Expense -> zero-effect Pending -> Confirm -> locked financial edit/name-only edit journey with reload persistence and zero final balances.
5. The R3 command maximum is 7 staged operations. OCC, replay/changed-intent idempotency, privacy, financial serialization, Pending-pair uniqueness, exact-poisha math, backdated/future-date policy, and historical locks are covered and green.

## Critical path and aggressive schedule

These are focused engineering-day ranges, not calendar promises. They assume immediate owner availability for the named acceptance windows, no new requirements, and no provider outage.

| Order | Release slice | Focus | Exit condition | Aggressive effort |
|---|---|---|---|---:|
| 0 | R2 unblock — complete | Typecheck fixed; single-project gate reconciled; no product name maximum | green | complete |
| 1 | Finish R2 — complete | Ten commands wired, Household capability enabled, backup/schema/journey/regression verified | two real accounts passed across reloads | complete |
| 2 | R3 Cards — complete | Private Card create/edit/delete-or-archive with transaction-time owner checks and no metadata leakage | cross-identity privacy and consent-race tests green | complete |
| 3 | R3 Expenses — complete | Exact-poisha writes, revision OCC, server Dhaka date, signed backdated confirmation, confirmed-settlement lock, private Card snapshot handling | provider parity plus edit/delete/create race rollback green | complete |
| 4 | R3 Settlements — complete | Mark Paid/Confirm/Reject/Cancel, exact-current recommendation check, Pending-pair guards, immutable confirmation | two-account financial journey and concurrency matrix green | complete |
| 5 | R4 Receipts | Trusted reservation/upload saga, quotas, private content reads/removal, orphan reconciliation | 10 MiB boundary, fault injection, privacy, and quota tests green | 1.5–2.5 days |
| 6 | R4 Retention | Deploy and exercise the once-daily function; verify Dhaka cutoff, delete-before-mark, recovery, and manual fallback | one live authorized execution plus idempotent rerun green | 0.5–1 day |
| 7 | R5 Release | Production deployment, full security/integration matrix, backup/runbook/rollback, owner smoke | production gates complete; owner acceptance pending | awaiting approval |

**Earliest responsible full release:** approximately **10–15 focused engineering days**, or roughly **2–3 calendar weeks** with prompt approvals and one uninterrupted implementation stream. Provider failures, a receipt-upload transport redesign, or newly discovered financial/security contradictions extend this range.

## Execution detail

### R2 — finish the current authorized phase

1. Repair the current non-behavioral TypeScript error and make all local gates green.
2. Reconcile Gate C tooling and documentation with the owner decision: the existing Appwrite project is the single backend; no disposable project or live restore drill blocks R2.
3. Wire all ten Household UI actions to their existing same-origin endpoints while preserving the frozen forms and dialogs.
4. Reconstruct authoritative Household state after every successful mutation, matching local `mutateAndReconstruct` behavior.
5. Add route-level tests for anonymous access, forged actor fields, malformed IDs, leader-only operations, stale state, idempotent replay, changed-intent reuse, and sanitized provider failures.
6. Run full gates. Back up and verify rows outside Git. Use only a temporary empty Household for the controlled delete/replay proof.
7. Run the two-account Create → Join → Accept → Rename → Transfer/Leave or Remove → Delete acceptance sequence, including reload/new-tab and the deferred first-login proof.
8. Stop for R2 owner review; do not begin R3 implicitly.

### R3 — ship financial writes in dependency order

Implement **Cards → Expenses → Settlements**. Reuse the frozen application/domain services and translate provider conflicts into the existing typed errors. Do not rebuild financial rules in Route Handlers. Enable each R3 capability only when its entire workflow and cross-identity tests are green; if partial enablement is needed, split the capability key before exposing a partial family.

R3 is the highest-risk part of the critical path. Completion requires live proof of exact allocations, Card privacy on the wire, stale Expense OCC, settlement-confirm-versus-expense-edit races, Pending-pair uniqueness, immutable confirmed history, and complete rollback.

### R4 — close the receipt lifecycle

Implement the reservation/upload/metadata saga and the scheduled retention Function. The 10 MiB approved receipt boundary must be proven on the selected hosting path before launch; it cannot be assumed from local tests. Keep Storage credentials and private metadata server-only, and retain the documented rows-only backup gap until a binary backup/export procedure is verified.

### R5 — deploy once, verify once, launch

Use one production-like candidate artifact for security QA and promotion rather than rebuilding after acceptance. Configure production secrets only in the host, scan the built client, run Chromium plus Firefox/WebKit smoke, exercise all four authorization shapes, and verify rollback before inviting normal household use.

Launch on the provider-generated HTTPS domain first. A custom domain is operational polish and must not delay initial private-household go-live.

## Hosting decision for the fastest zero-cost path

**Recommended default: [Appwrite Sites](https://appwrite.io/docs/products/sites), Next.js SSR, in the existing Appwrite project.** Appwrite documents [full Next.js support without an adapter](https://appwrite.io/docs/products/sites/quick-start/nextjs), supplies a generated HTTPS domain, keeps application and backend operations in one provider, and offers Sites on its Free plan. Set `APP_COMPOSITION=appwrite` and deploy only the runtime credential plus auth HMAC/allowlist configuration; never deploy bootstrap or provisioning credentials.

Why this is preferred over Vercel Hobby for this release:

- Vercel Hobby is restricted to personal, non-commercial use, which may fit this private household project but is a policy constraint to keep reassessing.
- [Vercel Functions impose a 4.5 MiB request/response payload limit](https://vercel.com/docs/functions/limitations), which conflicts with the approved 10 MiB receipt boundary if files pass through a Route Handler. Avoiding that would require a direct-upload/token design and additional proof.
- Appwrite Sites keeps the first deployment operationally simpler, though its request timeout and upload-body behavior still require a real 10 MiB R4 probe.

If Appwrite Sites fails the R4 upload proof or Next.js build/runtime gate, the fallback is Vercel with a provider-approved direct-to-Appwrite Storage upload design; that is a controlled R4 architecture decision, not a silent reduction of the receipt limit.

## Owner actions that remove idle time

1. Confirm Appwrite Sites as the default host, or explicitly choose another zero-cost host.
2. Name the approved account that will create the production Household.
3. Reserve two short supervised windows: R2 two-account acceptance and R5 final four-role/security smoke.
4. Keep the remaining account provisioning and self-registration redesign out of the release critical path; provision only approved users needed for acceptance/go-live.
5. At each checkpoint, approve the next phase promptly or stop. The plan does not convert R2 authorization into blanket R3–R5 authorization.

## Go-live checklist

- All approved users required for launch can log in, restore sessions, recover passwords, and log out with server-side revocation.
- Household, Card, Expense, Settlement, and Receipt mutations are enabled and verified; no “next production update” notices remain for frozen MVP workflows.
- Exact-poisha/provider parity, financial locks, OCC, idempotency, permissions, Card/receipt privacy, retention, and audit history pass.
- Rows backup is verified; receipt binary backup/export and restoration procedure is documented and exercised to the extent approved in R4.
- CI and the production-like candidate pass lint, typecheck, full Vitest/architecture, production build, dependency audit, diff check, client-secret scan, multi-browser smoke, and Axe.
- Production environment contains only runtime-required secrets. Bootstrap and provisioning keys are absent/revoked.
- Generated-domain HTTPS smoke, error-log scan, Appwrite usage check, scheduled Function execution, rollback, and owner acceptance are recorded.

## Explicitly deferred until after launch

Self-service registration, email verification, multiple Households, local-to-cloud sync/import, custom domain, categories, budgets, recurring expenses, exports, notifications, OCR, banking/payment processing, paid monitoring, and cosmetic redesign.
