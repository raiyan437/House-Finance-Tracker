# House Finance Tracker

Local-first shared household expense tracking, implemented through Raiyan's AIDOS workflow.

## Current status

Phase 1 establishes the project and test foundation only. Product features, financial domain logic, IndexedDB repositories, Appwrite, and deployment are not implemented.

## Commands

- `npm run dev` - start local development.
- `npm run lint` - run ESLint.
- `npm run typecheck` - run strict TypeScript checks.
- `npm test` - run Vitest and React Testing Library tests.
- `npm run test:architecture` - enforce source dependency boundaries.
- `npm run test:e2e` - run the Playwright Chromium smoke flow.
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

- `src/domain`: pure TypeScript business and financial rules.
- `src/application`: use cases and repository interfaces.
- `src/infrastructure`: replaceable local/Appwrite adapters.
- `src/presentation`: reusable UI composition.
- `src/app`: Next.js routes and the application composition root.

Appwrite is prohibited until the local MVP is stable.

Project decisions and phase authorization live in [`docs/ai`](docs/ai/README.md).
