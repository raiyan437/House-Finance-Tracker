# House Finance Tracker

Private shared household expense tracking with exact integer-poisha financials, implemented through Raiyan's AIDOS workflow.

## Current status

Production runs the full Appwrite composition at [house-finance-tracker.appwrite.network](https://house-finance-tracker.appwrite.network). The v1.2.0 release adds the server-authoritative current-plus-previous-two Dhaka calendar-month Expense entry window and private one-picture-per-user Profile avatars. Live Schema V6 is additive and zero-drift; Receipt retention/quota remains Receipt-only, avatars have separate 24-hour orphan cleanup, and operator backup/restore covers authoritative Receipt and avatar binaries. Real Profile Picture mutation remains separately owner-gated.

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
