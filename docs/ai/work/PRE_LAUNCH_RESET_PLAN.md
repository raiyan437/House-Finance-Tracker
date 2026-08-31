# v1.1 Pre-Launch Production Test-Data Reset

## Status and authorization

Owner-authorized on 2026-08-31. This is destructive operator infrastructure work over production test data, not a schema reset or product-domain command. Schema V5 is authoritative and must remain intact at `schema_metadata.active.version = 5`; the earlier Schema V4 contract remains unchanged except for the already-approved `profiles.displayName` capacity widening.

The deployed v1.1 Profile/Auth build is the intended real-user baseline. The same three normalized approved-email allowlist entries remain configured, but their existing test Auth identities and all current application/Receipt data are disposable. No approved email may be submitted after reset; real users self-sign up and create/join their Household themselves.

## Safety gates

1. Keep the worktree scoped to operator reset tooling, tests, and v1.1 documentation; run the complete established regression matrix.
2. Use `npm run appwrite:reset-production` as a sanitized dry run. It is fixed to the known production endpoint/project/origin, requires Schema V5 and exactly three allowlist entries, and refuses target override arguments.
3. Stop if any Auth identity is neither allowlisted nor anonymous/test-only. Never print an email, API key, password, session/HMAC secret, or backup content.
4. Create and fully verify a fresh external `PRE-LAUNCH TEST-DATA BACKUP` containing all 14 tables and every available Receipt binary before execution.
5. Destructive execution requires `--yes`, the exact phrase `DELETE ALL TEST DATA FOR FRESH START`, and the verified external backup directory. The CLI re-verifies the backup and exact pre-reset counts before mutation.
6. Verify the existing maintenance deployment is Ready, scheduled `0 0 * * *`, and has no client execute permission; pause only its schedule, reset data in deterministic dependency order, and restore/verify the same deployment and schedule in `finally`.
7. Delete Receipt files; the 13 non-schema tables; then disposable Auth users. Missing resources are retry-safe already-clean results. Never touch `schema_metadata`, schema resources, Site/domain, Web platform, environment, keys, or deployment history.
8. Require Auth/Receipt/business counts zero, exactly one `schema_metadata.active` row at version 5, a zero-drift schema plan, healthy maintenance, anonymous auth smoke, unchanged allowlist, clean/synchronized `main`, and no repository artifacts before release.

## Dry-run checkpoint

The initial sanitized dry run passed: production endpoint/project/origin and Schema V5 matched, the allowlist retained exactly three entries, 2 existing Auth identities both classified as approved-email test users, and no unexpected or anonymous identity was present. The current application/Receipt rows and files are test-only per owner decision. No provider mutation occurred.

## Release boundary

After the verified zero-state and anonymous production smoke, update the authoritative state, commit the reset tooling/docs, ensure the accepted runtime remains healthy, and create annotated tag `v1.1.0` on the accepted `main` release commit. Do not pre-create an Auth user, Profile, Household, Expense, or any other business record.
