# House Finance Tracker

Private shared household expense tracking with exact integer-poisha financials, implemented through Raiyan's AIDOS workflow.

## Current status

Production v1.0.1 runs the full Appwrite composition at [house-finance-tracker.appwrite.network](https://house-finance-tracker.appwrite.network), with live Schema V4 clean. The owner-authorized v1.1.0 change is currently uncommitted for review: approved emails can self-sign up through a trusted server-only allowlist without email verification, existing-account Signup remains non-destructive, and authenticated users can update their password from Profile before being returned to Login. Provider user limit `3` is recommended only after all three intended Auth accounts exist and remains an owner/Console action. No real account/password mutation, deployment, release, or tag is included in the local implementation authorization. See [`docs/ai/work/V1_1_AUTH_PLAN.md`](docs/ai/work/V1_1_AUTH_PLAN.md).

## Commands

- `npm run dev` - start local development.
- `npm run lint` - run ESLint.
- `npm run typecheck` - run strict TypeScript checks.
- `npm test` - run Vitest and React Testing Library tests.
- `npm run test:watch` - run unit tests in watch mode.
- `npm run test:architecture` - enforce source dependency boundaries.
- `npm run test:e2e` - run the Playwright suites (Chromium; Firefox/WebKit via the cross-browser smoke spec).
- `npm run build` - create a production build.
- `npm run r5:receipt-fixtures` - create checksum-pinned Receipt acceptance fixtures outside Git.
- `npm run r5:decompression-fixture` - create the deterministic decompression-heavy rejection fixture outside Git.
- `npm run r5:provider-status -- --site <site-id>` - print a sanitized, read-only provider status when the local operator credential has the required scopes.

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
