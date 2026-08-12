# House Finance Tracker — AI Instructions

This repository uses Raiyan’s AIDOS Model. Before changing files, read:

1. `docs/ai/PROJECT_RULES.md`
2. `docs/ai/PROJECT_STATE.md`
3. `docs/ai/REQUIREMENTS.md`
4. `docs/ai/work/ACTIVE_PLAN.md`
5. `docs/ai/AI_LESSONS.md`

The approved, frozen product and design context is consolidated in `docs/ai/REQUIREMENTS.md`. Do not change frozen behavior casually. If implementation exposes a contradiction, missing business rule, security issue, or financial loophole, stop before inventing behavior, document the impact, recommend a resolution, and obtain approval when product behavior would change.

Keep business and domain logic framework- and Appwrite-independent. Preserve exact integer poisha arithmetic for all money values. Work locally first, keep the project at zero additional cost, and split substantial work into explicit phases.

For every meaningful change:

- state the phase and intended outcome;
- make the smallest coherent change;
- verify it proportionally;
- update `PROJECT_STATE.md`, `ACTIVE_PLAN.md`, or `AI_LESSONS.md` when the project state, plan, or durable learning changes.

Do not add Appwrite integration before the local MVP is stable.

Implement only the currently approved phase in `docs/ai/work/ACTIVE_PLAN.md`. A roadmap is not blanket authorization to execute every phase.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
