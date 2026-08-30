# v1.1 Allowlisted Self-Signup + Profile Password Update

## Status and authorization

**Owner-authorized on 2026-08-30; implementation and local verification are complete and remain uncommitted for owner review.** This plan is the currently approved phase and supersedes only the earlier pre-provisioned-account/signup-lockdown/password-recovery-only authentication policy. Schema V4 and all Household, financial, Card, Expense, Settlement, Receipt, privacy, retention, persistence, and maintenance behavior remain frozen.

## Intended outcome

- `/signup` is the canonical three-field Email/Password/Confirm Password flow; `/register` redirects to it and Login links to it.
- The trusted same-origin `POST /api/auth/signup` boundary normalizes email, enforces the server-only `HFT_ALLOWED_ACCOUNT_EMAILS`, applies a five-attempt/day/IP HMAC-opaque throttle, creates an ordinary Appwrite Account without an admin Users credential, bootstraps the existing Profile model, creates a password session, and sets the existing hardened `hft_session` cookie.
- Existing approved accounts receive a non-destructive Sign in/reset-password result. Non-approved email receives the explicit frozen error and no Appwrite account creation call.
- Trusted actor/session restoration continues to re-check the approved allowlist, denying direct non-approved Appwrite accounts.
- Production Profile adds Current/New/Confirm password fields. `POST /api/auth/password` derives identity only from `hft_session`, uses session `Account.updatePassword`, clears the local cookie on success, and returns the user to Login.
- Email verification, OAuth, phone, invite flows, production email editing, privileged Users API password mutation, and Schema V5 remain absent.

## Verification and stop boundary

Run focused auth/signup/password tests, full Vitest, architecture guards, ESLint, TypeScript, production build, dependency audit, diff-check, built-client secret scans, Chromium, Firefox/WebKit smoke, 430/390/360 responsive checks, and serious/critical Axe checks. Do not create/delete a real production account, use the unused approved email, change a real production password, alter Appwrite project user limits, deploy, commit, tag, or release without separate owner authorization.

## Local verification result

Complete on 2026-08-30: focused v1.1 tests 57/57; full Vitest 739/739 across 94 files; architecture guard 16/16; ESLint, TypeScript, Next.js 16.3 production build, zero-vulnerability audit, and `git diff --check` green. The built browser/HTML scan covered 85 files with zero server-secret names, allowlist names, or configured secret-value hits and zero password-logging source hits. Local Chromium passed 72/72; Firefox and WebKit smoke passed 1/1 each with explicit local composition. Signup passed 430/390/360 geometry, >=44px action sizing, keyboard/label semantics, and zero serious/critical Axe findings. The authenticated production Profile responsive/Axe test is implemented in the opt-in live suite but was not run because this uncommitted build is not deployed and no real password/account mutation is authorized.
