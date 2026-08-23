# House Finance Tracker

Local-first shared household expense tracking with exact integer-poisha financials, implemented through Raiyan's AIDOS workflow.

## Current status

The complete local application is finished and verified at the `pre-appwrite-local-v1` checkpoint: simulated development identities, household onboarding and management, expenses with receipts, settlements, private cards, dashboard/analytics/monthly reports, receipt retention, settled-history locks, OCC/idempotency hardening, and a responsive accessible UI. Production backend integration (Appwrite), real authentication, scheduled server-side retention, and deployment are intentionally not implemented and remain separately gated phases.

## Commands

- `npm run dev` - start local development.
- `npm run lint` - run ESLint.
- `npm run typecheck` - run strict TypeScript checks.
- `npm test` - run Vitest and React Testing Library tests.
- `npm run test:watch` - run unit tests in watch mode.
- `npm run test:architecture` - enforce source dependency boundaries.
- `npm run test:e2e` - run the Playwright suites (Chromium; Firefox/WebKit via the cross-browser smoke spec).
- `npm run build` - create a production build.

## Dependency boundaries

```text
Presentation -> Application -> Domain
                        ^
                        |
           Repository interfaces
                        ^
                        |
              Infrastructure
```

- `src/domain`: pure TypeScript business and financial rules (no React, no storage, no framework).
- `src/application`: use cases, projections, validation schemas, and repository interfaces.
- `src/infrastructure`: replaceable local IndexedDB adapters, the client runtime, and future Appwrite adapters.
- `src/presentation`: feature UI composed from application projections.
- `src/app`: Next.js routes; route pages stay Server Components behind one client composition root.

Charts are isolated to a single lazily loaded boundary (`presentation/analytics/analytics-charts*.client.tsx`); Recharts never enters the initial Dashboard/Report route graphs.

Appwrite is prohibited until Phase 13 is separately authorized.

Project decisions and phase authorization live in [`docs/ai`](docs/ai/README.md).
