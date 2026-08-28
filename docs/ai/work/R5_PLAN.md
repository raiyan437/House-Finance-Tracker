# R5 Plan — Appwrite Sites Production Deployment and Release Readiness

## Status and authorization

Authorized for implementation by the owner on 2026-08-29. R4 is checkpointed at `840d907211f5d79793096613539981c099049161`. Implement R5 only on `feature/phase-13-appwrite`, deploy that feature branch for production-integration acceptance, and stop before merge, final release, or tag. `main` and `local-mvp-v1` remain untouched until separate owner approval.

## Frozen architecture and scope

GitHub deploys one Next.js SSR Site on Appwrite Sites using the generated HTTPS `*.appwrite.network` domain and the existing Appwrite project. The trusted same-origin Next.js Route Handlers retain exclusive browser access to Appwrite Auth, TablesDB commands, and private Storage; the existing maintenance Function remains independent of the frontend deployment.

R5 adds no product feature, financial rule, privacy rule, schema, backend, database, browser-direct private Storage access, synchronization layer, Vercel dependency, or OpenNext adapter. If Appwrite Sites cannot carry the approved exact 10 MiB Receipt through the trusted Route Handler, stop and obtain owner approval for the smallest secure redesign.

## Deployment-readiness implementation

- Replace custom deployed `APPWRITE_*` runtime names with `HFT_APPWRITE_ENDPOINT`, `HFT_APPWRITE_PROJECT_ID`, `HFT_APPWRITE_RUNTIME_API_KEY`, `HFT_AUTH_HMAC_SECRET`, `HFT_ALLOWED_ACCOUNT_EMAILS`, and `HFT_APP_ORIGIN`; retain operator-only bootstrap/provisioning/backup variables solely in local tooling.
- Validate `HFT_APP_ORIGIN` as an origin-only absolute URL, HTTPS in production, with no credentials, path beyond `/`, query, or fragment. Construct recovery/reset and other security-sensitive absolute URLs only from it.
- Enforce applicable same-origin auth/mutation requests against the configured trusted origin without trusting `Host`, `X-Forwarded-Host`, request URL origin, or arbitrary Origin headers for callback construction.
- Preserve `HttpOnly`, production `Secure`, `SameSite=Lax`, `Path=/`, host-only session cookies whose expiry follows the Appwrite session.
- Prove a clean Linux dependency installation and Next.js build on Node 22; keep pinned `sharp` full decoding and native libvips support.

## Site configuration

Framework Next.js; Node 22; repository root; install `npm install`; build `npm run build`; output `.next`; request timeout 30 seconds. First integration deployment uses `feature/phase-13-appwrite`; the generated HTTPS origin is recorded into `HFT_APP_ORIGIN`, registered as an Appwrite Web platform, and followed by a redeployment. No generated hostname is hard-coded in source.

## Acceptance gates

1. Anonymous and authenticated HTTPS smoke proves the real Appwrite composition, existing Household data, no finance IndexedDB, no development identity tooling, no fake data, no localhost dependency, and no browser/hydration errors.
2. Close the deferred production-auth proof across supported Chromium, Firefox, and WebKit: login, reload, new tab, logout, remote revocation, anonymous redirect, recovery email, Site-origin reset callback, password reset, and fresh login.
3. Checksum-pinned JPEG/PNG/WebP fixtures cover small, about 1 MiB, about 5 MiB, exactly 10,485,760 bytes, over-limit, malformed, truncated, and decompression-heavy inputs. Exact-boundary acceptance proves full transport bytes and checksum, sharp decode, reservation, Storage, metadata/outcome, reload, private proxy, and preview. Multipart overhead is explicitly part of the Site transport gate.
4. Run the approved two-user Card/Expense/Settlement/Receipt journey without destroying meaningful retained history; validate private projections and historical metadata retention.
5. Exercise forged-resource, authority, OCC, idempotency, date/backdated, settlement, quota/reservation, image, direct-provider, cross-origin, and Host/recovery-poisoning boundaries with no privacy leak, partial write, secret leak, or raw provider error.
6. Verify the full 1440/1280/1024/768/430/390/360 responsive matrix, keyboard/focus/reduced-motion/200%-zoom/touch workflows, and zero serious/critical Axe findings.
7. Measure one cold and at least three warm samples for the authenticated load, major read screens, Receipt uploads, and private preview; fix only demonstrated production defects.
8. Reverify the deployed maintenance Function, Asia/Dhaka retention semantics, schedule, no client execution, healthy latest execution, and sanitized logs without broadening the Site runtime key.
9. Create and verify a fresh external binary-inclusive backup after QA; preserve the R4 backup; document reversible Site, Function, additive Schema V4, data-restore, and operator-emergency procedures without a destructive production restore.
10. Capture sanitized real usage and configure bounded Site/Function deployment retention preserving the current deployment, immediate previous healthy deployment, and useful rollback history.
11. Repeat full Vitest, architecture guards, ESLint, TypeScript, production build, dependency audit, diff-check, client/browser secret and raw Storage-ID scans, browser suites, responsive/Axe, HTTPS smoke, exact 10 MiB acceptance, backup verification, and zero-drift Schema V4 plan.

## Stop boundary

After every deployment and QA gate is green or explicitly accepted, update README and production/AIDOS release documents, leave the feature branch ready for review, and stop with `R5 — PRODUCTION DEPLOYMENT READY FOR OWNER ACCEPTANCE`. Do not merge to `main`, repoint final production to `main`, or tag until the owner separately authorizes final release.

Recommended reasoning: high for R5; xhigh if the hosting transport requires a secure 10 MiB redesign.
