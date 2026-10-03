# Session and idle-return resilience plan

Date: 2026-10-03 (Asia/Dhaka)
Status: S1-S4 implemented; local verification complete; Ubuntu cross-browser CI passes 27/27, while verification CI remains blocked by the strict audit. S5 deployment explicitly withheld by the owner on 2026-10-03 because the strict dependency audit gate remains red.

## Outcome and scope

Returning after inactivity must either restore a usable authenticated application, clearly request sign-in when the session is invalid, or show a recoverable connectivity state. Buttons must not silently fail or remain pending indefinitely. Temporary failures must not be presented as session expiry or cause duplicate financial actions.

This is one owner-authorized maintenance phase, split into the ordered slices below. The owner initially authorized implementation and delivery on 2026-10-03, then explicitly selected "Keep the strict audit gate; prepare the fixes without deploying" after the unresolved dependency advisory was identified. That later instruction supersedes release authorization: prepare a reviewable branch/draft PR, keep the strict audit command unchanged, and do not merge or deploy. Update ACTIVE_PLAN and this document as verification completes.

## Evidence and remaining uncertainty

- ProductionApplicationRuntime refreshes bootstrap on mount and window focus. It does not subscribe to visibilitychange, pageshow, or online; overlapping refreshes have no ordering guard.
- Bootstrap 401/403 currently triggers Login. Individual JSON requests throw SESSION_UNAVAILABLE for either status but do not centrally invalidate the runtime. Some callers suppress errors. Receipt binary requests and Profile/password/auth forms have separate request handling.
- Any failed bootstrap other than 401/403 replaces the shell with the full unavailable screen, unmounting route forms. There is no bounded automatic read retry or explicit request deadline in the browser wrapper.
- The HttpOnly cookie expires at Appwrite's returned session expiry. No custom inactivity timer was found. Expired/revoked actor resolution returns 401; provider failures return 503.
- Baseline verification: 29 existing runtime, read-envelope, and account-service tests passed. Anonymous production Login returned 200 and bootstrap returned the expected 401/no-store. These checks did not reproduce an authenticated idle incident.
- Site metadata and execution history were unavailable through the current operator credential. Hosting cold starts, actual session lifetime, and the incident's failing request/status remain unconfirmed. Do not widen credentials or change hosting settings to assume a cause.

## Approved product contract — REQUIREMENT CHANGE, approved 2026-10-03

UI impact: distinguish checking/reconnecting, expired session, forbidden operation, and sustained service failure. Recover automatically from brief read failures, retain mounted forms during transient outages, and redirect on a confirmed invalid session from any protected request.

Domain/data impact: none. Keep exact integer poisha arithmetic, existing authorization, command idempotency, financial history, Receipt sagas, and local composition. No schema migration, new storage, paid service, polling/keep-alive service, or change to Appwrite session lifetime is proposed. Server actor verification remains authoritative on every request.

Test impact: add deterministic failure, resume, race, and lost-response coverage at the transport/runtime and browser boundaries. Do not persist private drafts or credentials to retain state across Login.

## S1 — Reproduce and classify

Entry: approve the maintenance phase and proposed contract above.

1. Inventory protected JSON/binary requests, Profile/password requests, swallowed errors, and loading/pending cleanup. Separate authentication failure from permission denial and operational failure.
2. Add failing regression cases for a ready runtime followed by command/read 401, bootstrap 503 then success, network loss, delayed response, tab resume, and competing bootstrap responses.
3. Reproduce with Playwright route interception in production composition: keep the tab open, simulate expiry/offline/transient server failure, then resume or click an action. Use fixtures rather than changing real passwords, revoking real sessions, or creating production financial records.
4. When existing read access permits, correlate an actual failure with endpoint category, HTTP status, elapsed time, and sanitized server failure category. Never log cookies, tokens, emails, financial bodies, Storage IDs, or raw provider messages. Record a permission limitation rather than treating missing logs as proof of a cold start.

Exit: reproducible client defects and a status-to-behavior matrix; clearly separate confirmed causes from unverified hosting hypotheses.

## S2 — Consistent request and session handling

1. Extract a browser transport used by production JSON requests and protected binary/form requests where applicable. Preserve bigint decoding and typed business errors. Handle HTML/empty/malformed error responses safely without exposing provider content.
2. A protected 401 invalidates the runtime immediately, removes protected UI, cancels pending read retries, and redirects once to Login with an accessible session-expired notice. Do not replay a pending mutation after sign-in.
3. A 403 remains a permission/origin denial. It must not log out a valid user. If its meaning is ambiguous, perform one authoritative bootstrap check: only a confirmed 401 triggers expiry; a successful check leaves the denial local; a failed check enters connectivity recovery.
4. Operational failures never clear a valid cookie or claim expiry. Preserve server cookie-clearing on confirmed anonymous resolution.
5. Bound request lifetime with AbortController, including body consumption. Proposed ceiling: 35 seconds per attempt and 45 seconds total per read operation, including backoff; later attempts use only the remaining budget. Cancel reads on teardown/invalidation. An aborted or timed-out POST has an unknown outcome, not proof it failed to commit.
6. Automatically retry only safe GET reads on network errors/timeouts or HTTP 502/503/504: at most two retries after 500 ms and 1,500 ms, within the total deadline. Do not retry 401/403/400/404/409/429, malformed successful payloads, or POST/upload/removal/auth requests automatically. Keep existing user-directed retry and command IDs.

Exit: tests prove status distinctions, finite requests, bounded retry counts, bigint parity, sanitized parsing, and zero automatic mutation replay.

## S3 — Safe recovery when returning to the tab

1. Revalidate on focus, visibilitychange to visible, pageshow after browser restoration, and online while visible. Coalesce near-simultaneous triggers over 500 ms and allow only one bootstrap recovery at a time. No periodic background polling.
2. On initial load, use bounded read recovery before the existing unavailable/Retry screen. From a ready page, keep its shell and forms mounted and show an accessible checking/reconnecting indicator. Treat displayed balances and permissions as potentially stale until bootstrap succeeds.
3. Block new mutation submissions during revalidation or connectivity failure with an explanatory state. Do not interrupt a mutation already sent or discard its result. Keep navigation/recovery controls usable; sustained failures expose Retry. Confirmed expiry removes protected content regardless of draft state.
4. On successful recovery, refresh authoritative session, membership, capabilities, and affected page reads. Protect against a late response restoring stale identity or permissions after expiry/logout. Keep action identities stable where appropriate so incidental focus checks do not reset forms or command retry IDs.
5. Audit page and button pending state: settle it in finally, surface errors previously swallowed by actionable controls, and avoid a disabled/loading state surviving a failed request. Preserve unsaved mounted forms only during transient recovery; do not save them to browser storage.

Exit: browser tests prove tab/mobile-style resume, duplicate event coalescing, offline-to-online recovery, sustained-outage Retry, form retention during temporary failure, and no stale response overriding expiry/logout.

## S4 — Preserve command outcomes and verify the full flow

1. Separate a successful mutation response from its follow-up refresh. If the mutation succeeded and refresh failed, show that it was saved but the view could not refresh; offer a read refresh instead of implying the action must be submitted again.
2. For a lost/timed-out mutation response, report that confirmation could not be obtained. Retain the original command ID and existing authoritative idempotency path for an explicit retry. Do not generate a replacement ID or infer success from stale UI.
3. Preserve existing Receipt partial-success semantics. Ensure expiry or connectivity handling cannot turn a partially completed upload/removal saga into a false all-success or all-failure claim.
4. Run focused transport/runtime/auth/Receipt tests, full Vitest, architecture checks, TypeScript, ESLint, and production build. Run the resume/outage browser suite in Chromium, Firefox, and WebKit, plus responsive/Axe checks for the new status and Login notice.

Required acceptance matrix:

| Scenario | Expected result |
| --- | --- |
| Valid session after tab suspension | One coalesced check; fresh data; working controls |
| Cookie missing or session revoked | Prompt Login redirect; no protected content remains |
| Read or action returns 401 after startup | Same centralized expiry handling |
| Action returns 403 with valid session | Visible denial; user remains signed in |
| One transient bootstrap/read failure | Bounded read recovery; no forced logout |
| Offline or sustained 503 | Mounted drafts retained; new writes blocked; Retry works |
| HTML error, empty failure, stalled body | Sanitized error; finite pending state |
| Overlapping recovery and logout/expiry | Late success cannot restore protected state |
| Mutation succeeds, refresh fails | Saved outcome communicated; only read is retried |
| Mutation response lost | Unknown outcome; explicit retry keeps command ID |
| Receipt saga partially completes | Existing partial-success and retry guarantees remain |
| Local composition | Existing local behavior and money calculations unchanged |

Exit: complete matrix green with no duplicate Expense, Settlement, comment, or Receipt action; documents updated with actual results and remaining limitations.

## S5 — Separately authorized release and production acceptance

Entry: all verification gates green and renewed owner release authorization. S5 is currently withheld by the owner's explicit strict-audit/no-deployment decision.

Deploy using the existing zero-cost workflow and retain the previous Ready deployment for rollback. Perform anonymous read-only smoke and, where authorized, authenticated read-only navigation/resume smoke. Compare first request after inactivity with subsequent requests and inspect sanitized diagnostics if available. Do not fabricate production business events or revoke a real user's session for testing.

If measured evidence identifies hosting timeout/cold-start or provider limits, propose a separate targeted infrastructure correction with its cost/security impact. Do not extend sessions, increase permissions, add paid resources, or introduce keep-alive traffic as part of this plan.

Exit: deployed acceptance recorded in PROJECT_STATE and ACTIVE_PLAN. Roll back on authentication loops, private-data exposure, duplicate actions, or loss of normal navigation; use the retained deployment rather than changing production data.

## Release blocker and verification environment

The 2026-10-03 audit identified newly reported vulnerabilities in the existing dependency graph. Compatible updates include Next.js/eslint-config-next 16.3.8 and transitive fixes for brace-expansion, fast-uri, ip-address, and undici. The shadcn direct version remains 4.17.0; no forced downgrade, replacement library, or audit exception was applied.

The remaining audit has eight inherited high-severity entries, all rooted in [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): braces through 3.0.3 has no patched release. These dependencies enter through shadcn's build tooling and eslint-config-next, not a new product request path. This is a release blocker under the unchanged `npm audit --audit-level=high` gate; scope/reachability does not convert a failed gate into a pass.

Local Chromium verifies the recovery scenarios against production composition and API fixtures. Firefox and WebKit cannot launch on this Windows host: dependency validation reports mozglue.dll, icuin77.dll, and libsharpyuv.dll despite a fresh isolated download containing those files. agent-browser is explicitly blocked by Device Guard; it was not bypassed. A separate public-repository GitHub Actions job runs the fixture-only recovery suite against Chromium/Firefox/WebKit on Ubuntu with no production credentials or business mutations.

Local final gate: full Vitest 885/885 across 113 files; architecture 16/16; ESLint, TypeScript, Next.js 16.3.8 production build, and whitespace check pass. Chromium production-composition recovery 9/9 and anonymous regression 3/3 pass. Recovery/Login Axe serious/critical findings are zero; reconnection status has no horizontal overflow at 360/390/430/768/1024/1440. Built-client server-secret/private-Storage-field marker scan is clean. Remaining audit: eight high entries, zero critical/moderate, all from the one unpatched braces advisory. No deployment, live Auth/business mutation, schema operation, or provider configuration change occurred.

Ubuntu evidence: [CI run 37121009613](https://github.com/raiyan437/House-Finance-Tracker/actions/runs/37121009613) passes recovery 27/27 (9 scenarios per browser). Its verify job passes lint, TypeScript, full tests and build, then fails only the strict dependency audit. Final local review additionally covers a stalled 403 body without retry or logout. A read-only production Login probe still returns the original page without the new expiry notice, confirming production is unchanged. Draft [PR #1](https://github.com/raiyan437/House-Finance-Tracker/pull/1) is the review artifact; no merge or production activation is authorized.
