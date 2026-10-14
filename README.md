# House Finance Tracker

Private shared household expense tracking with exact integer-poisha financials, implemented through Raiyan's AIDOS workflow.

## Current status

House Finance Tracker v1.5.0, including the completed 2026-10-03 session/idle-return resilience maintenance release, is released on the full Appwrite composition at [house-finance-tracker.appwrite.network](https://house-finance-tracker.appwrite.network); the recorded release passed CI and live acceptance, and the previous application revision remains documented for rollback. See [current project state](docs/ai/PROJECT_STATE.md) for recorded release evidence and the current local maintenance scope. Every active member may view available Receipts on same-Household Expenses while upload/removal remains creator-only. Expense categories use twelve persisted semantic values through a compact, accessible icon-only selector; the v1.5 additions are `electricity` and `loan`, while historical keys remain unchanged. Schema V9 is additive and zero-drift after the approved enum expansion. Financial, Settlement, Receipt retention/quota, avatar, authentication, and Household rules are otherwise unchanged.

## Commands

The accepted redesign and local optimization are recorded in [the optimization verification report](docs/ai/work/OPTIMIZATION_VERIFICATION_2026-10-12.md). These changes require a code deployment only; they introduce no schema, data, permission or maintenance-worker migration. The shadcn scaffolding CLI is development-only, while the UI uses shared components and the three required Radix state variants in `globals.css`.

- `npm run dev` - start local development.
- `npm run lint` - run ESLint.
- `npm run typecheck` - run strict TypeScript checks.
- `npm test` - run Vitest and React Testing Library tests.
- `npm run test:watch` - run unit tests in watch mode.
- `npm run test:architecture` - enforce source dependency boundaries.
- `npm run test:e2e` - run the Playwright suites (Chromium plus selected cross-browser smoke/auth/session specs).
- `npm run benchmark:history` - measure synthetic 1/5/10-year history through the real read/projection paths without credentials. See the [measurements and limits](docs/ai/work/HISTORY_READ_BENCHMARK_2026-10-11.md).
- `npm run build` - create a production build.
- `npm run r5:receipt-fixtures` - create checksum-pinned Receipt acceptance fixtures outside Git.
- `npm run r5:decompression-fixture` - create the deterministic decompression-heavy rejection fixture outside Git.
- `npm run r5:provider-status -- --site <site-id>` - print a sanitized, read-only provider status when the local operator credential has the required scopes.

CI also runs the local critical Household, Expense, Settlement, Card and responsive UI journeys: all selected cases in Chromium and tagged core journeys in Firefox/WebKit. To reproduce, set `APP_COMPOSITION=local` and `HFT_CRITICAL_E2E=1`, leave `PLAYWRIGHT_BASE_URL` unset, and run `npx playwright test tests/e2e/household-onboarding.spec.ts tests/e2e/household-management.spec.ts tests/e2e/expenses.spec.ts tests/e2e/settlements.spec.ts tests/e2e/cards.spec.ts tests/e2e/ui-redesign.spec.ts tests/e2e/mobile-layout.spec.ts tests/e2e/glass-navigation.spec.ts --workers=2`. These fixtures use a fixed browser date and never access a deployed site. CI retains browser failure artifacts for seven days. WebKit uses a separate disposable persistent profile per test for native IndexedDB Blob support; receipt persistence runs on every platform without a Windows skip.

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
- `src/infrastructure`: replaceable local IndexedDB and implemented server-only Appwrite adapters, plus runtime composition.
- `src/presentation`: feature UI composed from application projections.
- `src/app`: Next.js routes; route pages stay Server Components behind one client composition root.

Charts are isolated to a single lazily loaded boundary (`presentation/analytics/analytics-charts*.client.tsx`); Recharts never enters the initial Dashboard/Report route graphs.

Appwrite work is restricted to the currently authorized release phase; completing one release phase does not authorize the next.

The accepted mobile layouts, glass navigation/performance and idle-loader/phone-date refinements are being prepared for a code-only release. See [deployment readiness](docs/ai/work/DEPLOYMENT_READINESS_2026-10-14.md) and [the release plan](docs/ai/work/UI_RELEASE_PLAN_2026-10-14.md). The proposed color treatment was reverted; production activation is still pending.

## v1.4 in-app notifications

v1.4.0 provides recipient-specific, in-app-only notifications: the Dashboard bell shows the latest five, and `/notifications` exposes retained history for the current plus previous two Asia/Dhaka calendar months. Read state is stored as nullable `readAt`; both surfaces offer server-authoritative Mark all as read for every retained unread row in bounded batches. An active Expense creator explicitly receives another member's comment notification, while the commenter and former creator do not. Notifications are ephemeral product context, not an audit log, financial source of truth, or command-outcome replacement. Push, email, SMS, Messaging, and Realtime remain out of scope. Schema V8 is applied and the existing maintenance Function performs notification expiry.

Project decisions and phase authorization live in [`docs/ai`](docs/ai/README.md).
