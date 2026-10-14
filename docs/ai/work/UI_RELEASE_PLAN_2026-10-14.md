# Production UI release plan — 2026-10-14

## Authorization and outcome

**Readiness authorization received:** the owner subsequently requests fixing the release gaps and getting ready for deployment. D0–D2 preparation is now authorized; D3 production activation and D4 live release remain unexecuted. The release branch is `codex/mobile-glass-ui-release`, based on confirmed remote `0ae12b1`. The current active Ready rollback ID is owner-confirmed as `6ace4d2ce216ab03e861`; Site API access returns 401 and browser initialization fails, so that ID is not independently inspected. The CI coverage gap is repaired, and integrated verification is in progress. The Appwrite session suite also gains a synthetic Expense-list/date regression case; its final count must be recorded after enumeration.

The owner requests a plan to deploy the accepted local changes. P0 is planning only and completes with this document. The proposed D0–D4 execution below has not started; no branch, commit, push, PR, merge or deployment is created by planning. Execute the release only after owner authorization, preserving the authorization already given when evaluating later gates.

Deliver one code-only release through the existing GitHub → Appwrite Sites pipeline to `https://house-finance-tracker.appwrite.network`. Preserve all production users, records, stored files, financial rules and existing provider configuration. The project remains at zero additional cost.

## Release contents

Include the accepted work since the previous release:

- M1–M4: mobile layouts with the web identity, reachable filters/dialogs, readable charts/metadata, shared accessibility corrections and requested Credits-route removal.
- G1–G3/G5–G9: glass on the desktop Dashboard-through-Household capsule, compact rail and phone dock; Safari-inspired coordinated selection, continuous interruption, desktop hover, no phone hover and rendering-performance repair.
- F1–F3: animated idle-resume/page loaders with mounted drafts and usable navigation; Expenses/Settlements data-loading animations; phone Expense Date below status/comments.
- Necessary regression tests, CI selection updates and compact AIDOS/release evidence.

Exclude the reverted C1–C3 color treatment, new features from the assessment recommendations, changes to auth duration/session policy, dependencies, Schema V9, permissions, resource namespaces, maintenance worker, domain calculations and stored data. Never run bootstrap/apply, reset, provisioning, migrations, restore, maintenance execution, session revocation or live business commands as deployment steps.

## Observed starting point

- Local branch: `main`. HEAD and the local `origin/main` tracking ref are `0ae12b1b719d7ec8639ee668f0f1f1a93ea4bec3`. These are local observations; refresh and verify the remote during D0.
- Previous release record identifies merge `fe346ecb2965a29308b6ed5ee6d7f894c8a979c6`; `0ae12b1` is later verification bookkeeping. Confirm the actually served source/deployment during D0 rather than assuming the active deployment ID.
- Accepted changes remain uncommitted, including required untracked application files: `mobile.css`, `glass-navigation.css`, `glass-selection.tsx`, `use-phone-layout.ts` and `expense-filters.tsx`, plus the mobile/glass browser suites. A tracked-only diff is an incomplete candidate manifest.
- Current diff has no change in `src/domain`, `src/application`, `src/infrastructure`, `src/app/api`, package/lock manifests or Next configuration. The production runtime change is render-only; its session/transport logic is preserved in the F verification record.
- `src/app/color-refinement.css` and `src/app/credits/page.tsx` are absent; color annotations/variables are absent. Credits removal is intentional. Source must continue to match the accepted post-rollback/F state.
- Latest F evidence passes 45 focused unit tests, 30 local responsive/motion cases, 45 intercepted production-session cases, types/lint and both builds. Earlier M/G evidence remains relevant, but a fresh integrated release run is required.
- Historical reference/capture directories total approximately 70 MiB. Review artifact inclusion rather than blindly staging the workspace; retain reviewable reports and links, keep secrets/private data/raw traces outside Git and avoid unnecessary hosting payload. Do not delete local history to shrink the candidate.

## Proposed sequential execution

### D0 — Freeze the candidate and rollback reference

1. Preserve the working tree and existing local evidence. Refresh remote refs, identify divergence and integrate without discarding accepted uncommitted work.
2. Inspect the existing Site's production branch, build trigger, runtime/build settings and active Ready deployment using available read-only access. Record active deployment ID/source SHA and a usable prior Ready deployment. Previous credentials could not inspect deployment IDs; resolve this through existing authorized Console access without widening credentials or guessing IDs.
3. Create a release branch with the `codex/` prefix, such as `codex/mobile-glass-ui-release`, once execution is authorized. Build a complete tracked/untracked source/test/docs manifest.
4. Confirm only approved UI/accessibility/loader/test changes are present; verify the reverted palette is absent and protected business/provider/configuration files match the baseline. Review for credentials, private data and unexpected generated files.
5. Capture a read-only before-release preservation baseline where available: aggregate table/file metadata digests and maintenance configuration, outside Git. Never print private record values. Account for genuine user activity or scheduled retention work when interpreting later digest changes; do not restore/delete data to force equality.

Exit: a frozen candidate manifest, verified source scope, known production/rollback references and unchanged provider/data configuration.

### D1 — Complete integrated verification and hosted test selection

1. Close the CI coverage gap: the critical-journey job currently passes only six spec paths. Add `mobile-layout.spec.ts` and `glass-navigation.spec.ts` to that command. Ensure the existing phone-date geometry cases are selected in Firefox/WebKit too; their names currently lack `@critical`. Change selection/tagging, not assertions or browser coverage.
2. Enumerate the final test matrix before running it. The session job already selects the three new loader/navigation cases, making 45 cases across three engines. Record actual full-unit and critical-journey counts rather than carrying forward the previous release's 924/132 counts.
3. Run clean installation from the unchanged lockfile, full unit/integration/architecture tests, lint, TypeScript, whitespace and the existing strict dependency audit. Investigate failures; retain traces and explain any scoped replays.
4. Run the integrated local financial/privacy/receipt/history and responsive suites, including phone date placement, mounted drafts, filters/dialogs, glass interruption/Back, reduced motion and narrow layouts. Use disposable local fixtures.
5. Stop only owned development/fixture servers before sequential local and Appwrite builds to avoid the previously observed Windows generated-type collision. Verify both optimized compositions, then run the complete intercepted Appwrite session suite.
6. Review actual desktop/phone captures. Ready desktop layout/financial content remains protected except the approved glass surfaces and Credits removal. Check data-loading/resume states and unchanged palette. Exercise production-style synthetic Expense-list data for the phone date check; local IndexedDB fixtures cannot simply be pointed at an Appwrite deployment.

Exit: all final candidate checks pass, updated hosted coverage is explicit, and no regression/secret/provider change remains unresolved.

### D2 — Review the exact commit through PR and preview

1. Commit the curated candidate on the release branch, push and create a PR to the verified production branch. Attach the PR to this chat when created. Describe final scope, data preservation, tests and rollback references.
2. Require every applicable hosted CI job to pass on the exact PR head; any subsequent application or test change invalidates those results and requires affected checks to rerun. Keep failure/retry evidence visible.
3. Verify Appwrite's preview build corresponds to that head and is Ready. Official Git behavior creates previews for non-production branches, with access limited to authorized organization members. Confirm this Site's actual filters/access before relying on a preview. [Appwrite Git deployment documentation](https://appwrite.io/docs/products/sites/deploy-from-git)
4. Review the real preview's desktop/phone appearance and exercise delayed resume, draft preservation, navigation, metadata and reduced motion through explicitly intercepted fixtures. Abort unmatched API requests; no real Household, Expense, Card, Receipt, Profile or Settlement write is part of preview QA.
5. Include an available physical Android/iPhone smoke review if practical; otherwise retain the emulator/physical-device limitation in the release decision. Do not claim guaranteed hardware FPS.

Exit: exact-head CI and preview are green, the concrete PR is reviewable, and the production release is authorized. If full release authorization has already been provided, do not ask for it again merely because this gate is reached.

### D3 — Activate production through the existing pipeline

1. Immediately before merge, confirm head/base refs, hosted checks, preview identity, rollback availability and source scope again. Verify the prospective merge tree matches the tested candidate. If the base introduces a different tree, update/retest the candidate and preview before merging.
2. Merge through the normal repository process, then confirm the actual merge tree matches the verified prospective tree. An unexpected difference is a release incident requiring rollback/investigation, not an invitation to test an already activated unverified tree.
3. Treat merge/push to the configured production branch as the production action: Appwrite normally builds and activates that branch automatically. It is not a harmless preparation step. No separate CLI deployment or host/environment change is planned. [Appwrite production-branch behavior](https://appwrite.io/docs/products/sites/deploy-from-git)
4. Record merge SHA, CI runs, deployment ID/status, previous Ready reference and release time. Require both build success and evidence that the live origin serves the intended build; a successful build alone is insufficient.

Exit: the verified candidate is actually served at the existing production origin with rollback still available.

### D4 — Live acceptance and release closeout

1. Check public Login/Signup/expiry-notice views and anonymous API denial/no-store behavior through read-only requests. Verify served UI assets and release identity.
2. Repeat the intercepted session suite against the live origin, plus production-style synthetic navigation/Expense date checks. Keep an unmatched-API abort barrier in every context; do not run local seeding or genuine financial/Profile/Auth mutation journeys against production.
3. Confirm desktop navigation boundaries/hover, phone dock/no-hover, animated loading, retained drafts, date placement, ordinary page colors, Cards/Household/Report access and removed Credits route.
4. Compare available read-only preservation metadata and maintenance settings. Investigate differences against legitimate concurrent activity; leave production records untouched.
5. Record observed build/runtime errors, test results, retries, device/access limitations and final deployment references. Update PROJECT_STATE/ACTIVE_PLAN and the release record; restore the normal local preview and stop owned fixture servers.

Exit: live read/fixture acceptance passes, the served revision and preservation evidence are recorded, and the release is complete. Follow-up monitoring is read-only; create a recurring monitor only if separately requested.

## Rollback

Rollback triggers include a stuck loader, lost drafts, broken navigation, privacy exposure, unexpected financial changes, unusable phone controls or widespread runtime errors attributable to the release.

1. Retain evidence and reactivate the previously recorded active Ready deployment through the existing Site's rollback control. Appwrite switches the served deployment without rebuilding or altering its code. [Appwrite instant rollback documentation](https://appwrite.io/docs/products/sites/instant-rollbacks)
2. Verify the restored source/assets and read-only/fixture health checks at the live origin.
3. Reconcile Git through a narrowly reviewed revert/hotfix so future automatic deployments cannot reintroduce the failed revision. Preserve unrelated work and record the cause.
4. Never restore/reset the database, delete users/files or change maintenance/schema/permissions as UI rollback. Data remains on Schema V9. Keep both deployment records.

The older `7a47d0e` reference belongs to the previous release's rollback history. Prefer the freshly captured current production deployment/source for this release, so a rollback does not unnecessarily remove the already accepted web redesign.

## Go/no-go checklist

- Accepted mobile/glass/F changes present; reverted colors absent.
- Complete candidate manifest includes required new source/tests and excludes secrets/private data.
- Full integrated checks, hosted exact-head CI and matching preview build pass.
- Ready desktop content, phone metadata, drafts/session safeguards and motion are reviewed.
- Provider/schema/data/maintenance configuration is unchanged.
- Actual current and rollback Ready deployment/source references are recorded and usable.
- Production activation is authorized before its triggering merge/push.
- Live acceptance and rollback procedure are concrete and preserve users/data.

Current status: P0 planning and D0–D1 candidate/local verification complete under the subsequent D0–D2 readiness authorization. D2 handoff results are recorded on the release PR; production activation D3–D4 remains unexecuted. See [the readiness record](DEPLOYMENT_READINESS_2026-10-14.md) for current gates and evidence.
