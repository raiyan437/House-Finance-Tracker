# Local optimization and cleanup verification — 2026-10-12

## Outcome and scope

The accepted design is consolidated into smaller shared presentation code with proven-unused cleanup. Production users, records, schema, permissions and operational configuration were not accessed or modified. All 341 protected business/application/infrastructure/API/runtime/configuration/operational files remain byte-identical to the starting working tree, including the earlier uncommitted maintenance. No new dependency, provider operation, migration, commit, push or deployment was introduced.

The sequential O0–O3 phases preserved a recoverable source baseline, audited references and generated styles, consolidated presentation, removed unused files, patched dependency advisories and verified the local and production compositions. Full source copies, SHA-256 manifests, package deltas, screenshots, traces and emitted-asset measurements are retained under `C:/Users/raiya/.codex/visualizations/2026/10/12/01a12fe3-ed2f-7aa1-b3ce-8934266bc625/optimization/` outside the checkout.

## Code and cleanup

- Dashboard and Monthly Report use independent shared payment-mix rows, avoiding Report's import of the Dashboard page. Cash/Card rendering keeps the exact existing amounts, percentages, labels, order and markup.
- Receipt placeholders and the four Expense filter shells share rendering; registration, parent state, callbacks, commands and authorization remain in their existing owners. Lazy chart bodies reuse the shared prop types.
- Shared CSS consolidates identical panel rules and removes superseded grid/typography declarations and unused sidebar tokens. Rail appearance uses its existing CSS instead of overridden utilities. Only the three used Radix open/closed/disabled variants replace the CLI's broad stylesheet; popup opening, immediate dismissal and reduced motion remain intact.
- Seventeen unused UI exports were removed with their unused definitions/styles. Internal portal, overlay and scrolling helpers remain wherever the UI needs them.
- Removed `src/presentation/components/member-row.tsx`, `src/presentation/shell/brand.tsx` and `public/house-finance-logo.png` after import, name, asset and framework-reference checks. The native SVG/ICO house icon, all category images and attribution route remain.
- Shadcn scaffolding remains available as a development dependency. Operational scripts, ad hoc admin entry points, backups/restores, domain tests and historical evidence are retained. The active state/plan registers are shortened, with their preceding text preserved verbatim in dated archives.
- Verification uncovered existing mobile chart date overlap and clipping. Reclaiming 8px of internal chart padding per side below 480px and allowing the Dashboard chart card to grow below 640px preserves full-sized dates, every calendar day, data, desktop dimensions and the established scrolling behavior. SVG geometry checks now measure actual glyph bounds and verify that the panel does not clip them.

## Measured changes

| Metric | Starting working tree | Final | Reduction |
| --- | ---: | ---: | ---: |
| Production-classified lockfile entries | 495 | 193 | 302 (61.0%) |
| Implementation source files, excluding tests/assets | 335 | 334 | 1 net file |
| Implementation source bytes | 1,405,547 | 1,397,778 | 7,769 |
| Implementation source lines | 31,736 | 31,570 | 166 |
| Appwrite-build emitted JavaScript bytes | 2,934,765 | 2,865,969 | 68,796 (2.34%) |
| Summed gzip JavaScript bytes | 878,510 | 862,127 | 16,383 |
| Appwrite-build emitted CSS bytes | 104,262 | 97,919 | 6,343 (6.08%) |
| Summed gzip CSS bytes | 18,649 | 17,789 | 860 |

JavaScript/CSS measurements sum emitted static assets, including deferred chunks; they are not per-page download or production latency measurements. Production package counts include optional/platform entries classified by the lockfile, not the actual installed package count on one machine. The clean development installation still includes the required build/test/scaffolding toolchain. Existing measured history-projection optimization remains unchanged; no speculative cache or financial aggregation was introduced.

## Dependency advisories

The cached offline audit initially reported zero vulnerabilities; the fresh registry audit found five advisories. Sharp is updated from 0.35.4 to the maintainer's patched 0.35.5, including matching native/libvips binaries. Compatible transitive updates resolve source-map-js 1.2.1→1.2.2, the development CLI's MCP SDK 1.30.0→1.32.1, proxy-addr 2.0.7→2.0.8 and postcss-selector-parser 7.1.5→7.1.6. No unrelated dependency version changes or force upgrade occurred. Full and production-only audits now report zero vulnerabilities.

Primary references: [Sharp advisory and patched version](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), [Sharp release](https://github.com/lovell/sharp/releases/tag/v0.35.5), [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [MCP SDK advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h), [proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [selector-parser advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf). These are dependency-audit findings, not evidence that this application or production data was exploited.

## Verification evidence

| Check | Result |
| --- | --- |
| Full baseline Vitest | 924/924 across 117 files |
| Clean install | `npm ci --include=dev --ignore-scripts` passes; native Sharp loads and real decoder suites pass |
| Full final Vitest | 924/924 across 117 files after source/dependency changes; includes exact finance, permissions, persistence, idempotency, Receipt/Avatar real-image decoding and architecture |
| Focused presentation checks | 47/47 across seven files |
| Core local Chromium/Firefox/WebKit journeys | 128 initial passes, three documented failures corrected/replayed successfully, one existing Windows WebKit Blob skip; 131 distinct cases covered successfully |
| Final core replays | 3/3 with one worker; full privacy, persistence, navigation and fixed-rail assertions retained |
| Intercepted production-session journeys | 36/36 across all three engines using the optimized Appwrite build |
| Additional Chromium analytics/notification/profile/IndexedDB/Select checks | 22 initial passes and one chart-layout failure; all 23 covered after the chart repair |
| Three-browser analytics | 29 initial passes and one Firefox geometry-measurement failure; corrected geometry passes 3/3, completing all 30 cases |
| Final chart/Dashboard/Report geometry, reflow and accessibility | 9/9 across the three engines after both narrow-screen corrections |
| Final local-composition optimized build | Pass |
| Final Appwrite-composition optimized build | Pass; generated Dashboard confirms the Appwrite composition |
| Lint, TypeScript, registry audits and whitespace | Pass; zero allowed lint warnings, zero reported dependency vulnerabilities |
| Protected source/configuration/operational hashes | 341 unchanged, zero added protected files |

Responsive checks cover 320/360/390/430/768/900/1024/1280/1440/1920px where applicable. Covered desktop/mobile screens have no page overflow or serious/critical Axe findings. Checks retain keyboard/focus restoration, immediate popup dismissal, real control clicks, drafts, recipient-isolated notifications, exact percentages/amounts, historical Card snapshots, immutable settled history and actor-specific Household/Settlement actions. The real server image suites decode JPEG/PNG/WebP and reject invalid/truncated/mismatched/oversized content using the patched library.

Before the chart corrections, all 16 final before/after screenshot pairs were pixel-identical. The later intentional narrow-chart width/height differences are isolated to chart content and panel growth; final screenshots were reviewed. Desktop and other presentation geometry remain covered by the original comparisons and final browser checks.

## Failures, diagnosis and isolation

The broad core run initially timed out on an old exact `More` accessible-name selector; the existing name includes pending-action counts. The selector now retains that meaningful prefix and the command/privacy assertions. A first isolated Household replay reached a cancelled/incomplete development-router flight after Send Join Request; awaiting the expected route before its Pending assertions improved synchronization, and the final full case passes. Two Firefox route/bootstrap checks timed out in the long concurrent development run; both pass isolated without production-code changes. No assertion was removed or error suppressed.

The additional chart check reproducibly failed at 390px. Diagnostics showed a 285px plot with two-digit glyph widths up to 10px, then visual review exposed fixed-height vertical clipping. The shared CSS corrections fix both. Firefox's screen rectangles include about 2px of non-glyph padding; native SVG glyph bounds transformed into screen coordinates preserve the overlap threshold while measuring the rendered text accurately. The final geometry checks also explicitly detect clipping by the containing panel.

Production-session tests now abort every API request unless a later explicit fixture handles it. The temporary Appwrite test server used port 3100, with no browser login or live-provider action. Automatic approval review blocked a separate attempt to start it with placeholder Appwrite settings; the existing configuration plus the mandatory fixture-only API barrier completed the same verification safely. No secret values, production identities or production records were inspected or modified.

## Deployment boundaries and remaining limits

This change needs a code deployment only. Schema V9, permissions, records, quotas, resource namespaces and the maintenance worker are unchanged; no bootstrap, reset, provisioning, migration or provider-maintenance command is needed for this update. Deployment and push remain separate owner actions. The local review app remains at `http://localhost:3000`.

Linux-hosted CI has not run these uncommitted changes. The existing Windows WebKit IndexedDB Blob persistence skip remains enabled on Linux; no new skip was introduced. Build-size reductions do not certify live-provider latency, security or data volume.

The separately documented existing provider reader truncates 5,001 matching rows to 5,000 outside the frozen volume envelope. It is unchanged by this refactor. [The prior benchmark finding](HISTORY_READ_BENCHMARK_2026-10-11.md) recommends detecting overflow and rejecting the incomplete financial read; that behavior change remains owner-approval-gated. No live data volume was checked, and this report does not claim correctness for histories exceeding that existing limit.

Automatic approval review rejected removal of the empty, ignored `test-results` directory, stating "blocked by policy." It remains empty and excluded from version control. Source cleanup is complete; no application code or data remains in that directory.
