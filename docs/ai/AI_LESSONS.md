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

## 2026-08-12 - Phase 2 exact finance engine

- A safe-integer `number` API can retain ergonomic poisha values while BigInt intermediates protect parsing, totals, division, multiplication, and remainder allocation from precision loss and overflow.
- The repository's ES2017 TypeScript target supports BigInt operations through constructor syntax but rejects BigInt literal syntax; use `BigInt(...)` unless the target is deliberately changed in a later approved phase.
- Exact allocation membership is independent of positive share value: zero-share selected participants must remain explicit so recalculation, validation, and later persistence preserve the original participant set.
- Canonical domain conversion stops at ungrouped decimal money text. Currency symbols, grouping, and localization belong to presentation and cannot feed financial calculations.

## 2026-08-12 - Phase 3 temporal finance and permissions

- Model external settlement claims as immutable snapshots: staleness is advisory, while confirmation applies the original exact amount and may legitimately reverse a later balance.
- Household balance aggregation and recommendation simulation both need BigInt working values and independently validated zero-sum boundaries; TypeScript types alone are not sufficient for persisted-looking financial records.
- Unordered-pair Pending uniqueness prevents crossing stale claims without rewriting history; terminal records remain historical evidence and do not block a later exact recommendation.
- Former-member safety is strongest as an invariant over a canonical financial fingerprint, allowing only changes that provably preserve amount, payer, participants, shares, date, payment history, and deletion state.
- Card privacy is a data-shape rule: non-owners receive no private reference, while leader edit intents can preserve an opaque reference internally or explicitly detach it without exposing it.

## 2026-08-13 - Phase 4 local application and persistence

- IndexedDB conditional uniqueness is best represented by optional, deterministic derived keys under ordinary unique indexes; inactive and terminal records omit the key so history remains without blocking future actions.
- Private card history requires physical data separation as well as projection rules. A non-owner leader can preserve an existing private expense record transactionally without loading its contents into that application operation.
- Household soft deletion must atomically convert active memberships to retained former records; otherwise active-membership uniqueness would strand users after the explicit household exit flow.
- Browser Blob objects may cross realms in test environments, so validate their observable metadata and readable bytes rather than relying on `instanceof Blob`. Test receipt signatures against actual bytes, not filename or MIME text alone.
- IndexedDB transaction callbacks must prepare validation and binary input before opening the transaction and keep participating stores on one transaction. Failed request/unique-index operations require explicit transaction rejection handling to avoid false success or unhandled aborts.
- A client-only local runtime plus application-owned current-session port preserves Next.js Server Component boundaries and leaves future Appwrite authentication/persistence replaceable.
