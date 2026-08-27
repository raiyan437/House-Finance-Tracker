# House Finance Tracker

Local-first shared household expense tracking with exact integer-poisha financials, implemented through Raiyan's AIDOS workflow.

## Current status

The complete local application is frozen at tag `local-mvp-v1`. Appwrite foundation, production authentication/session, and the read-only production data plane are committed on `feature/phase-13-appwrite`; live schema v2 and provider transaction semantics are verified. The authorized R2 Household command core is in progress in the uncommitted working tree. Financial writes, receipt Storage/retention, final security QA, and deployment remain gated R3-R5 work. See [`docs/ai/work/EARLIEST_PRODUCTION_PLAN.md`](docs/ai/work/EARLIEST_PRODUCTION_PLAN.md) for the current critical path.

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

Appwrite work is restricted to the currently authorized release phase; completing one release phase does not authorize the next.

Project decisions and phase authorization live in [`docs/ai`](docs/ai/README.md).
