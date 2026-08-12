# Implementation Planning Workflow

This workflow applies after the approved requirements/design context is received.

## Before planning

1. Read all AIDOS control documents and inspect the repository.
2. Extract explicit requirements, constraints, acceptance criteria, and open questions.
3. Separate domain logic, application orchestration, infrastructure, and UI concerns.
4. Identify the local MVP boundary and the later Appwrite boundary.
5. Recommend a model/reasoning level for each phase based on ambiguity, coupling, risk, and verification cost.

## Phase planning

Every phase must state:

- objective and scope;
- dependencies and entry criteria;
- files/modules likely to change;
- recommended model/reasoning level and why;
- tests and verification evidence;
- exit criteria and any deferred work.

Use smaller phases for high-risk domain calculations, persistence boundaries, and user-critical flows. Keep Appwrite out of local MVP phases unless the user explicitly changes the rule.

## Execution loop

For each phase: confirm scope → implement the smallest slice → run focused checks → run broader checks when appropriate → inspect the result → update state and lessons → report evidence.

## Required quality checks

- Money/domain logic: deterministic unit tests with integer poisha values and boundary cases.
- UI behavior: accessible interaction checks and Playwright coverage for critical flows.
- Forms: Zod validation tests and user-visible error-state checks.
- Charts: verify data mapping and empty/loading states.
- Integration boundaries: verify domain logic does not import Appwrite.

No implementation phase may begin while the approved requirements/design context gate in `PROJECT_STATE.md` is open.
