# Phase 13 - Appwrite Production Architecture Plan (approved Rev 2 + final corrections)

**Status:** Owner-approved 2026-08-23 (Decisions A-D finalized below). Baseline: `local-mvp-v1` (`332ad38`). Implementation proceeds through independently gated slices 13A-13M; completing one slice never authorizes the next.

## Frozen operating envelope

1 production Household · maximum 4 active members (Leader included) · maximum 4 approved production accounts · approximately 15 Expenses/month (<=180/year) · private in-house use; public SaaS unsupported. Priorities: security, correctness, simplicity, zero cost, maintainability.

## Approved decisions

- **Decision A:** `MAX_ACTIVE_HOUSEHOLD_MEMBERS = 4`, enforced authoritatively inside the trusted transaction via guard rows; stable error `HOUSEHOLD_MEMBER_LIMIT_REACHED`; former memberships retained and excluded from the active count.
- **Decision B (revised by owner):** Production accounts are admin pre-provisioned; self-service registration is disabled. `ALLOWED_ACCOUNT_EMAILS` is the sole server-side approved-account list, maximum 4 normalized unique emails. Missing/blank/malformed/>4 entries fail closed; one to four valid unique emails enable exactly that approved set. The list is never exposed to the browser.
- **Decision B follow-up (unresolved 2026-08-26):** the owner now prefers eventual self-service account creation, but the replacement architecture is deferred because self-registration without email verification leaves account ownership/squatting unresolved. The implemented pre-provisioned model and registration lockdown remain authoritative until that dedicated decision; do not restore registration or add verification during Phase 13C.
- **Decision C (revised by owner):** No pending-request cap. Under the four-user envelope `M + J <= 4` (M = active memberships >= 1 Leader, J = pending Join Requests), so Household deletion is bounded without a cap.
- **Decision D:** Appwrite Free operational limitations accepted: ~7-day inactivity pause (app unavailable, schedules halted, manual Console resume), ~90-day paused-project deletion risk, no provider backups, no SLA. Runbook: resume -> app returns -> idempotent maintenance worker catches up. No artificial traffic.

## Trusted architecture

Browser (frozen UI) -> Next.js Route Handlers (trusted boundary: session verification, actor resolution, Clock/IDs injection, throttles) -> unchanged Application/Domain layers -> Appwrite adapter (`src/infrastructure/appwrite/*`, server SDK + runtime API key) -> Appwrite Cloud Free (1 database, 13 tables + schema metadata, 1 private bucket, 1 scheduled Function). Browsers hold no Appwrite keys and make no direct Appwrite calls. IndexedDB remains the dev/test provider; no synchronization; production composition does not construct it.

## Data model highlights

- Money columns are **BigInt (64-bit)**: `expenses.amountPoisha`, `settlements.amountPoisha`, `settlements.originalAmountPoisha`. Mappers reject values outside `Number.isSafeInteger`; no floats or rounding anywhere.
- General `expenses` rows carry only `paymentMethod = cash | card` plus non-private data. All private Card identity/snapshot state lives exclusively in `expense_card_private_details` (owner-only).
- **No persisted derived financial state**: no balances, recommendation caches, analytics aggregates, checkpoints, and **no `financialLockedAt`** — the Confirmed-settlement lock stays derived from server-authoritative `createdAt <= latest confirmed resolvedAt`.
- Auth user.email is the single authoritative login email; `profiles` stores display name/version/timestamps only. Production email editing is unsupported and no independently writable mirrored email exists. Email verification is unused. Password recovery establishes first password ownership and remains the supported password-change path.
- `coordination_guards`: deterministic row IDs = prefix + truncated SHA-256 (cryptographic; collision yields a safe conflict), full logical key stored and verified on read. Kinds: active-membership per user, active-Leader per household (ownerValue), pending-join per user, pending-settlement per unordered pair, financial revision counter, plus uploader/project byte counters. Guards are coordination metadata only.
- Receipts: metadata outlives binaries (`available` / `user-deleted` / `retention-expired`); frozen policies unchanged (3/Expense, 10 MiB/file enforced at bucket level too, 50 MiB/uploader, 1 GB ceiling, 800 MB warning, current-month+2 retention). Practical binary ceiling ≈ 200 MiB at four users. Content served through the authorized proxy endpoint; direct Storage access deferred until measurements justify it.

## Household deletion transaction math

Operations = tombstone(1) + membership updates(M) + membership-guard deletes(M) + leader-guard delete(1) + JR closures(J) + join-guard deletes(J) + closure audits(J) + household audit(1) + financial-guard participation(2) = **4 + 2M + 3J <= 15 operations** at the worst feasible state (M=1, J=3) — far under the verified Free-plan limit of 100 staged operations per transaction. Single atomic transaction; no closing lifecycle, batching, or worker.

## Rate limiting, idempotency, timestamps

Proportionate fixed-window throttles stored as opaque HMAC-SHA256-derived guard keys (never raw emails/IPs): login 10/15min, recovery 3/h, reset completion 5/15min, and house-code lookup 10/h. No registration throttle exists. Completed `command_outcomes` remain retained indefinitely; DB-only commands commit business mutation + audit + outcome in one transaction; upload saga uses explicit reservation states. All lifecycle timestamps are server-created via the injected Clock in local/dev and the trusted command instant in production; Expense Date remains the validated user business date.

## Slices (each separately gated)

13A foundation + reproducible schema · 13B auth/session · 13C read adapter · 13D trusted commands/timestamps/guards · 13E OCC/idempotency · 13F household/membership/JR · 13G expenses · 13H settlements · 13I cards · 13J receipts · 13K retention/reconciliation worker · 13L dashboard/report verification · 13M security/provider regression.

## Backup tooling (planned)

`infra/appwrite/backup` admin script: manual monthly / pre-migration / pre-dangerous-change exports of all tables to timestamped JSON outside Git with counts/checksum manifest, optional retained-binary export, plus a verify-restoring companion. No user-facing Export feature.

## Environment variables (names only; values never enter Git)

| Name | Scope | Purpose |
|---|---|---|
| `APPWRITE_ENDPOINT` | server | Cloud endpoint URL |
| `APPWRITE_PROJECT_ID` | server (+ browser-safe later) | Project identifier |
| `APPWRITE_RUNTIME_API_KEY` | server-only secret | Trusted commands; rows/files/session scopes only |
| `APPWRITE_BOOTSTRAP_API_KEY` | server-only secret, bootstrap tooling only | Schema provisioning; never deployed to Vercel runtime |
| `APPWRITE_PROVISIONING_API_KEY` | temporary admin-only provisioning tooling | Auth Users API only (`users.read`, `users.write`); never normal runtime or browser |
| `ALLOWED_ACCOUNT_EMAILS` | server-only configuration | Authoritative approved-account list; fail-closed, ≤4 emails |

Placeholders live in the local ignored `.env.example`; the tracked `.gitignore` rule `.env*` intentionally keeps all such files out of version control.
