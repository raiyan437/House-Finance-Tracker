# v1.1 Pre-Launch Production Test-Data Reset

## Status and authorization

Owner-authorized on 2026-08-31. This is destructive operator infrastructure work over production test data, not a schema reset or product-domain command. Schema V5 is authoritative and must remain intact at `schema_metadata.active.version = 5`; the earlier Schema V4 contract remains unchanged except for the already-approved `profiles.displayName` capacity widening.

The deployed v1.1 Profile/Auth build is the intended real-user baseline. The same three normalized approved-email allowlist entries remain configured, but their existing test Auth identities and all current application/Receipt data are disposable. No approved email may be submitted after reset; real users self-sign up and create/join their Household themselves.

## Safety gates

1. Keep the worktree scoped to operator reset tooling, tests, and v1.1 documentation; run the complete established regression matrix.
2. Use `npm run appwrite:reset-production` as a sanitized dry run. It is fixed to the known production endpoint/project/origin, requires Schema V5 and exactly three allowlist entries, and refuses target override arguments.
3. Stop if any Auth identity is neither allowlisted nor anonymous/test-only. Never print an email, API key, password, session/HMAC secret, or backup content.
4. Create and fully verify a fresh external `PRE-LAUNCH TEST-DATA BACKUP` containing all 14 tables and every available Receipt binary before execution.
5. Destructive execution requires `--yes`, the exact phrase `DELETE ALL TEST DATA FOR FRESH START`, and the verified external backup directory. The CLI re-verifies the backup and requires it to cover every current row/file, which preserves the original pre-reset snapshot while allowing safe resume after partial progress.
6. Verify the existing maintenance deployment is Ready, scheduled `0 0 * * *`, and has no client execute permission; pause only its schedule, reset data in deterministic dependency order, and restore/verify the same deployment and schedule in `finally`.
7. Delete Receipt files; the 13 non-schema tables; then disposable Auth users. Missing resources are retry-safe already-clean results. Never touch `schema_metadata`, schema resources, Site/domain, Web platform, environment, keys, or deployment history.
8. Require Auth/Receipt/business counts zero, exactly one `schema_metadata.active` row at version 5, a zero-drift schema plan, healthy maintenance, anonymous auth smoke, unchanged allowlist, clean/synchronized `main`, and no repository artifacts before release.

## Completed checkpoint

Completed on 2026-09-01. The final sanitized preflight matched the production endpoint/project/origin and Schema V5, retained exactly three allowlist entries, classified all three existing Auth identities as approved-email test users, and found zero unexpected identities. External backup `C:\Users\raiya\hft-backups\hft-backup-2026-09-01T12-06-06.228Z` was created outside Git and independently verified all 14 table exports, checksums, three Receipt binaries, and image decodes before mutation.

The first execution was interrupted by a provider-side TypeError after partial deletion. Its `finally` restoration returned maintenance to the original Ready deployment and schedule. The CLI resume gate was corrected and tested so the original verified backup must cover every remaining live count rather than equal a partially depleted state. Resume then removed the remaining rows and all three Auth users. Final independent checks report Auth 0, Receipt files 0, every non-metadata table 0, exactly one `schema_metadata.active` row at version 5, all 14 tables complete, and zero creates/drift/provisioning/errors. Maintenance deployment `6a9191b88f673aa0155f`, Receipt bucket, Site/domain, environment, and three-entry allowlist are unchanged.

Anonymous production smoke passed Chromium, Firefox, and WebKit; Login/Signup toggles passed the 1440/1024/768/430/390/360 matrix with zero serious/critical Axe findings. The permitted non-allowlisted Signup probe returned `Email not allowed. Contact admin.` and the subsequent inventory remained fully empty. No approved email, real password, or Display Name was submitted.

## Release boundary

The accepted `main` documentation checkpoint is the `v1.1.0` release target. After its CI and Appwrite Site deployment are Ready, create the annotated tag on that exact commit. Do not pre-create an Auth user, Profile, Household, Expense, or any other business record.
