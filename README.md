# House Finance Tracker

Private shared household expense tracking with exact integer-poisha financials, implemented through Raiyan's AIDOS workflow.

## Current status

Production runs House Finance Tracker v1.3.0 on the full Appwrite composition at [house-finance-tracker.appwrite.network](https://house-finance-tracker.appwrite.network). Every active member may view available Receipts on same-Household Expenses while upload/removal remains creator-only. Expense categories use the ten semantic values through a compact, accessible icon-only selector; comments are active-member-only, append-only plain text with a 1–1000-character limit, and list counts are derived. Live Schema V7 is additive and zero-drift. Financial, Settlement, Receipt retention/quota, avatar, authentication, and Household rules are otherwise unchanged.

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

## v1.4 in-app notifications

v1.4.0 provides recipient-specific, in-app-only notifications: the Dashboard bell shows the latest five, and `/notifications` exposes retained history for the current plus previous two Asia/Dhaka calendar months. Read state is stored as nullable `readAt`; both surfaces offer server-authoritative Mark all as read for every retained unread row in bounded batches. An active Expense creator explicitly receives another member's comment notification, while the commenter and former creator do not. Notifications are ephemeral product context, not an audit log, financial source of truth, or command-outcome replacement. Push, email, SMS, Messaging, and Realtime remain out of scope. Schema V8 is applied and the existing maintenance Function performs notification expiry.

Project decisions and phase authorization live in [`docs/ai`](docs/ai/README.md).
