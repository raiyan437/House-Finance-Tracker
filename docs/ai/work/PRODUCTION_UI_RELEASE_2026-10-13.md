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

### First hosted result and test-harness correction

Candidate `4c9cda2` passes both verify jobs (924 tests/117 files, build, strict audit) and both 36-case intercepted session jobs. Appwrite reports preview build success. Both critical-journey jobs fail: the PR run records 128 passed, three flaky recoveries and one failed WebKit receipt case. Artifacts/traces are retained outside Git.

The receipt case fails in the local IndexedDB adapter before commit; no production adapter or data is involved. A minimal native probe confirms the same Blob write fails with `UnknownError: Error preparing Blob/File data to be stored in object store` in WebKit's ephemeral profile and succeeds with a persistent profile on this Windows host. Fixture WebKit contexts now use a unique, bounded test-output profile, close it and remove only that owned directory. Receipt seed data and the complete create/reload/preview journey are enabled for WebKit on every platform; the old Windows skip is removed. No application storage representation or schema changes.

The initial fixture route changes from membership-gated Dashboard to independent Household before seeding, avoiding a queued no-Household redirect competing with the post-seed Dashboard navigation. Navigation errors remain visible rather than swallowed. Focused native/profile, receipt, membership, settlement and dropdown checks precede a fresh full hosted run. R1 remains blocked until these gates pass.

Focused Windows verification passes 15/15 across Chromium/Firefox/WebKit (1.4 minutes), including native receipt creation, exact percentage shares, persistence after reload, image preview, membership acceptance, Settlement History and dropdown dismissal. TypeScript, zero-warning lint and whitespace pass. A first focused invocation was intentionally interrupted to rename the Playwright callback from `use` to `applyContext`, avoiding React-hook lint misclassification; the final complete invocation passes. The application source, provider configuration and production data are unchanged by this correction.

## R1 — Code deployment (pending R0)

Merge/deploy only after hosted checks pass. Retain the previous source revision and available Ready deployment for rollback; do not delete deployments or change hosting/environment/worker settings.

## R2 — Live acceptance (pending R1)

Check Login, Signup, session-expiry notice, anonymous API denial/no-store, new UI asset markers and fixture-only recovery journeys against the live origin. Record any read-only preservation evidence and limits. No claim of a real 24-hour live session test is made without such evidence.

## Existing limits

The previously documented 5,000-row history cap remains unchanged; this release does not authorize its separate behavior change. Local measurements do not establish Free-plan quota headroom or Appwrite build timing. No production data has been modified by this release work.
