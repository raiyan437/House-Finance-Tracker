# AI Lessons

Durable project learnings only. Add entries when a discovery or correction should influence future work.

## 2026-08-12 — AIDOS initialization

- The product requirements and UI/UX design are frozen, but their approved context is not present in the workspace yet.
- Treat that missing context as a planning gate; do not infer screens or domain behavior.
- Keep poisha values as integers throughout domain calculations and test the boundary explicitly.

## 2026-08-12 - Frozen context reconciliation

- The approved context is now consolidated in `REQUIREMENTS.md`; the missing-context planning gate is closed.
- Financial determinism requires explicit tie-break rules, not merely exact totals.
- Card privacy constrains data shape and edit workflows, including leader actions; hiding fields visually is insufficient.
- Pending settlements and historical-member edits are temporal financial cases that need approved rules before their domain phases.
- Canonical desktop screens define the reusable visual language; responsive and remaining screens extend that baseline during implementation.

## 2026-08-12 - Phase 1 foundation

- Next.js 16.3 appends a managed, version-aware guidance block to the existing root `AGENTS.md` during development; it preserved the AIDOS instructions and points agents to bundled local framework docs.
- Clean-checkout typechecking must not depend on generated Next route types; the root layout uses an explicit `ReactNode` contract.
- Vite 8 resolves TypeScript paths natively, so `vite-tsconfig-paths` is unnecessary.
- Architecture guards now enforce that domain/application code cannot import framework, Appwrite, or inward-facing layers.
