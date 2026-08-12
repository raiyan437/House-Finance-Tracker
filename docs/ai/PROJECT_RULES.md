# Project Rules

## Scope

House Finance Tracker is a local-first shared household expense-tracking application. The application records financial activity and external settlement claims; it never processes or transfers money.

## Technical rules

- Use Next.js with TypeScript.
- Use Tailwind CSS and shadcn/ui for interface construction.
- Use Lucide for icons and Recharts for charts.
- Use React Hook Form with Zod for form handling and validation.
- Use Vitest for unit/domain tests and Playwright for browser flows.
- Keep business/domain logic independent of Appwrite and UI frameworks.
- Integrate Appwrite only after the local MVP is stable.
- Perform all money calculations as exact integers in poisha. Never use JavaScript floating-point arithmetic for money.
- Keep local development and dependencies within zero additional project cost.

## Delivery rules

- Large work must be split into phases with explicit entry/exit criteria.
- Do not invent requirements or UI behavior when the approved context is missing.
- Prefer reversible, small changes and verify each meaningful change.
- Update the AIDOS documents when a decision, state, plan, or durable lesson changes.
- Do not commit secrets, credentials, or user financial data.
- Treat `REQUIREMENTS.md` as frozen product and design policy. Label behavior changes as `REQUIREMENT CHANGE`, explain their domain, data, test, and UI impact, and obtain approval before implementation.
- Preserve financial history with soft deletion and sufficient audit events; confirmed settlements are immutable.
- Never expose private card metadata to anyone except the card owner, including leaders, logs, hidden UI, and local state intended for another viewer.

## Execution gate

The approved requirements/design context and implementation clarifications are frozen. Execute one explicitly authorized phase at a time. Phase 1 is complete; Phase 2 is not authorized. Appwrite remains gated until the local MVP is declared stable.
