# Production UI release — 2026-10-13

## Authorization and preservation boundary

The owner explicitly requests the 24-hour session policy and production deployment of the accepted UI update, preserving all users, user records and stored files strictly. Deliver the existing verified local maintenance/refactoring, accepted design and optimization as one code-only release through GitHub/Appwrite Sites. Schema V9 and the existing resource namespaces, financial contracts, allowlist, permissions and maintenance worker remain unchanged.

No bootstrap/apply, reset, provisioning, data migration, real-user login, password change, session revocation, business-command QA, maintenance execution or storage deletion is part of this release. Live acceptance uses anonymous reads and explicitly intercepted browser fixtures. Any permitted inventory inspection uses read-only provider APIs and emits only aggregate counts/digests, never private record values.

## R0 — Candidate verification (complete)

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

Candidate `026c024` passes the complete push workflow; its critical job has 129 passed and three recovered flaky cases. Its parallel PR workflow fails only the Dashboard visual case at its original 30-second whole-test timeout (six viewport screenshots plus Axe and persistent-profile setup); it has 130 passed, one recovered notification-dropdown race and one timeout failure. Receipt persistence now passes on hosted Linux WebKit. The Dashboard case adopts the existing 90-second visual-test budget without changing assertions. Dropdown testing explicitly waits for the known fixture's two unread notifications before capturing trigger text, retaining the unchanged-content and dismissal assertions. A fresh candidate must pass both complete workflows before merge.

The final focused Dashboard/dropdown invocation passes 6/6 across all three browsers (59.1 seconds), with zero-warning lint and TypeScript. No assertion, browser coverage, production code or data-preservation check is removed.

Both final candidate workflows pass: [PR CI 38415841126](https://github.com/raiyan437/House-Finance-Tracker/actions/runs/38415841126) and [push CI 38415829302](https://github.com/raiyan437/House-Finance-Tracker/actions/runs/38415829302). Each verifies 924 tests/117 files, lint, types, builds, strict audit, 36 intercepted session cases and the complete 132-case critical journey set, including recovered retries. The PR critical job reports 131 passed plus one recovered flaky Card case; retained logs preserve the failures rather than claiming zero retries. Appwrite reports the tested head `130db02` preview build succeeded. [PR #2](https://github.com/raiyan437/House-Finance-Tracker/pull/2) is CLEAN/MERGEABLE with unchanged base `7a47d0e`.

A fresh GET-only pre-merge inventory matches the original before snapshot exactly across all 16 tables and all 12 stored-file metadata/signature records. The enabled maintenance worker, schedule, active deployment and execute permissions also match. No provider write was made during R0.

## R1 — Code deployment (complete)

Merge/deploy only after hosted checks pass. Retain the previous source revision and available Ready deployment for rollback; do not delete deployments or change hosting/environment/worker settings.

PR #2 merged as `fe346ecb2965a29308b6ed5ee6d7f894c8a979c6` at 2026-10-13T14:59:03Z after all exact-head gates passed. The merge tree matches tested candidate `130db02`; no additional application change was introduced. Appwrite reports production build success, and the normal live `/login` returns HTTP 200 with `journey-auth-shell`, absent before release. Provider deployment ID remains unavailable to the scoped credential, so status plus the changed live content are the deployment evidence. No existing deployment was deleted; source `7a47d0e` remains available for code rollback.

Merged-main [CI 38418095182](https://github.com/raiyan437/House-Finance-Tracker/actions/runs/38418095182) passes all jobs: verify (924 tests/117 files, lint, types, build, strict audit), 36 intercepted production-session cases and 132/132 critical journeys.

## R2 — Live acceptance (complete)

Check Login, Signup, session-expiry notice, anonymous API denial/no-store, new UI asset markers and fixture-only recovery journeys against the live origin. Record any read-only preservation evidence and limits. No claim of a real 24-hour live session test is made without such evidence.

Anonymous live Login, Signup and `/login?sessionExpired=1` return HTTP 200 with the new UI; the latter exposes the expiry notice. Anonymous bootstrap remains 401/no-store, and `/api/session` reports anonymous without a session cookie. The live favicon returns 200 and its SHA-256 matches `src/app/favicon.ico`.

The first parallel live fixture invocation reports 33 direct passes, two recovered flaky cases and one failed permission-denial case. A serial nine-case replay reports seven direct passes, one recovered expiry case and one failed uncertain-write case. A retained expiry context shows `Reconnect before saving. Your draft is still here.`: the test clicked before the tab-focus connection check completed, so the simulated mutation never reached its fixture. The live harness now brings the test page forward, waits for the successful bootstrap response and the checking state to clear before intentionally submitting a ready-state mutation. Outage tests keep their blocked-write assertions. No application behavior or production record changes.

Corrected targeted live replay passes 9/9 without retries (33.5 seconds). The final complete serial live invocation passes 36/36 without retries (2.3 minutes), covering all three browsers, session expiry/403 distinction, coalesced resume, drafts, offline recovery, uncertain command IDs, save/refresh outcomes, responsive controls and Axe. Every API operation remains explicitly mocked or aborted; no production financial/Profile/Auth command is submitted.

GET-only before, pre-merge and after inventories match exactly across all 16 tables and all 12 stored-file metadata/signature records, including schema metadata and private history. Maintenance enabled state, schedule, active deployment and execute permissions match. The scoped credential cannot inspect Auth accounts or the Site deployment ID; no credential was widened, no account mutation was made, and the 24-hour Console value remains owner-confirmed. A real 24-hour user-session experiment and binary re-download were not performed.

Final bookkeeping changes tests/documentation only, with an empty application/runtime/dependency/configuration/asset diff from the accepted live merge. Release artifacts and digests remain outside Git under `C:/Users/raiya/.codex/visualizations/2026/10/12/01a12fe3-ed2f-7aa1-b3ce-8934266bc625/release-2026-10-13/`. No reset, provisioning, migration, worker update, permission change, stored-file deletion, account deletion or user-data rewrite occurred.

## Existing limits

The previously documented 5,000-row history cap remains unchanged; this release does not authorize its separate behavior change. Local measurements do not establish Free-plan quota headroom or Appwrite build timing. No production data has been modified by this release work.
