# Production UI release — 2026-10-13

## Authorization and preservation boundary

The owner explicitly requests the 24-hour session policy and production deployment of the accepted UI update, preserving all users, user records and stored files strictly. Deliver the existing verified local maintenance/refactoring, accepted design and optimization as one code-only release through GitHub/Appwrite Sites. Schema V9 and the existing resource namespaces, financial contracts, allowlist, permissions and maintenance worker remain unchanged.

No bootstrap/apply, reset, provisioning, data migration, real-user login, password change, session revocation, business-command QA, maintenance execution or storage deletion is part of this release. Live acceptance uses anonymous reads and explicitly intercepted browser fixtures. Any permitted inventory inspection uses read-only provider APIs and emits only aggregate counts/digests, never private record values.

## R0 — Candidate verification (in progress)

- Pre-release main/remote revision: `7a47d0e`; fetch confirms no divergence.
- Previous completed local evidence: [optimization report](OPTIMIZATION_VERIFICATION_2026-10-12.md), including 924 tests, both compositions and intercepted cross-browser acceptance.
- Current Console automation is unavailable: both `cua_repl` and `node_repl` fail to initialize with a missing kernel-assets path.
- The owner confirms saving production Appwrite Session length as 24 hours / 86,400 seconds. This is owner-confirmed, not independently observed provider configuration. No users or existing sessions were deleted for this change.
- Existing login/signup cookies follow provider `session.expire`; protected 401 handling and focus/visible-tab/online session checks remain unchanged. No exact-expiry browser timer or auto-renewal loop is introduced.
- Release branch: `codex/ui-release-24h-sessions`; pre-push lint, fresh strict registry audit (zero vulnerabilities) and whitespace pass. No secret/environment files are staged.
- GET-only inventory captured all 16 production tables as counts/SHA-256 digests without logging or storing private values. This remains outside Git. Counts include three Profiles, one Household, 44 Expenses and two Settlements, below the existing financial-read envelope. The maintenance schedule/active deployment were read without changes. Auth-account/Site inspection is unavailable to the current credential (401); credentials were not widened.
- Commit, PR and hosted gates: pending.

## R1 — Code deployment (pending R0)

Merge/deploy only after hosted checks pass. Retain the previous source revision and available Ready deployment for rollback; do not delete deployments or change hosting/environment/worker settings.

## R2 — Live acceptance (pending R1)

Check Login, Signup, session-expiry notice, anonymous API denial/no-store, new UI asset markers and fixture-only recovery journeys against the live origin. Record any read-only preservation evidence and limits. No claim of a real 24-hour live session test is made without such evidence.

## Existing limits

The previously documented 5,000-row history cap remains unchanged; this release does not authorize its separate behavior change. Local measurements do not establish Free-plan quota headroom or Appwrite build timing. No production data has been modified by this release work.
