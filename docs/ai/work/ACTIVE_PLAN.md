# Active Implementation Plan

## Current phase — R0 release verification, 2026-10-13

The owner explicitly authorizes the 24-hour session policy and production deployment of the accepted UI/maintenance/optimization, strictly preserving all user data. R0 records approval, checks the complete candidate and runs hosted CI on a separate release branch. R1 merges/deploys only after the release gates pass. R2 checks anonymous live behavior and read-only preservation evidence, retains rollback, and records the result. Execute these phases sequentially; no reset, provisioning, migration, schema/permission change, maintenance-worker update, authenticated QA mutation or paid service is authorized.

The owner reports saving Appwrite Session length as 24 hours / 86,400 seconds. Both computer-control tools fail to initialize on this host, so this is owner-confirmed configuration rather than an independently inspected Console value. Existing cookie/provider-expiry and focus/visible-tab/online checks need no implementation change. No new exact-expiry browser timer is introduced.

Release evidence is maintained in [PRODUCTION_UI_RELEASE_2026-10-13.md](PRODUCTION_UI_RELEASE_2026-10-13.md). R0 is in progress; no merge or production code deployment has occurred yet. The pre-release main revision is `7a47d0e`.

## Completed phase — O0–O3 local optimization and cleanup, 2026-10-12

The owner accepted the design and requested full local optimization followed by cleanup, preserving every feature and existing production users/data before a later owner-managed deployment. The sequential phases below are complete. [OPTIMIZATION_VERIFICATION_2026-10-12.md](OPTIMIZATION_VERIFICATION_2026-10-12.md) is the fresh verification record; [PROJECT_STATE.md](../PROJECT_STATE.md) is the current status summary.

That earlier authorization included local refactoring, proven-unused cleanup, compatible dependency security updates and verification repairs. Deployment was outside that phase; the 2026-10-13 owner instruction separately authorizes the narrow release phases above.

| Phase | Outcome and exit evidence |
| --- | --- |
| O0 — Baseline and audit | Existing uncommitted work copied outside the checkout, source/configuration SHA-256 manifest recorded, 924 baseline tests passed, Appwrite baseline build and six representative responsive journeys passed. Import, CSS and package audits scoped the changes. |
| O1 — Shared presentation | Payment rows, Receipt placeholders, filter shells and chart prop types consolidated; overridden CSS/utilities and 17 unused UI exports removed. Three exact Radix state variants retain popup behavior. Focused checks and before/after screenshots passed. |
| O2 — Cleanup | Obsolete Brand/MemberRow/PNG icon removed; shadcn moved to development dependencies. Operational entry points, backups/restores, financial suites and evidence retained. Sharp 0.35.5 and compatible transitive patches resolve the registry advisories; no unrelated dependency version changes. |
| O3 — Final verification | Clean installation, 924 tests, both optimized compositions, zero-warning lint, TypeScript, audits and whitespace passed. Core/privacy/financial, intercepted session, additional analytics/notification/profile/persistence and responsive/accessibility cases passed with documented replays and one existing Windows-only Receipt skip. |

O3 uncovered existing mobile chart date overlap and vertical clipping. Reclaiming 8px of internal padding per side below 480px and allowing the Dashboard chart card to grow from its existing minimum below 640px makes the complete labels visible without smaller fonts or changed data. The SVG geometry regression now measures actual glyph bounds and checks overlap, clipping, alignment and scrolling; nine final geometry/Dashboard/Report cases pass in all three engines.

All 341 protected business/persistence/API/runtime/configuration/operational files remain byte-identical to the optimization baseline. Schema V9, exact poisha, immutable history, private metadata, receipt/avatar authority, session recovery and command contracts are unchanged. Only the listed dependency patches and presentation/test/documentation changes are introduced.

The source baseline, package deltas, screenshots, metrics and traces are saved outside the checkout under `C:/Users/raiya/.codex/visualizations/2026/10/12/01a12fe3-ed2f-7aa1-b3ce-8934266bc625/optimization/`. The app remains available locally at `http://localhost:3000`. Deployment is a separate owner action; this code update requires no schema, data, permission or maintenance-worker migration.

## Explicit remaining limits

- Linux-hosted CI has not run these uncommitted changes. The Windows WebKit IndexedDB Blob case remains enabled on Linux; no skip was added for this optimization.
- The existing 5,000-row provider-read overflow finding remains unchanged and separately approval-gated; see [the benchmark report](HISTORY_READ_BENCHMARK_2026-10-11.md). No live user/data volume was inspected.
- Build-size measurements are summed emitted assets; they do not establish production latency or certify the live provider. No live-provider operation or deployment was performed.

## Historical plans

The detailed preceding maintenance, U1–U9 and O0–O3 checkpoints are preserved verbatim in [ACTIVE_PLAN_HISTORY_2026-10-12.md](ACTIVE_PLAN_HISTORY_2026-10-12.md). Older checkpoints remain in [ACTIVE_PLAN_HISTORY_2026-10-11.md](ACTIVE_PLAN_HISTORY_2026-10-11.md). Archives preserve evidence and never authorize new work.
