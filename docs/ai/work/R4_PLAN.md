# R4 Plan — Receipt Storage and Retention

## Status and authorization

Approved for implementation by the owner on 2026-08-27. R3 is checkpointed at `01d82897e246aadee611d01ca977b1fb0cb3d1d4`. Implement R4 only on `feature/phase-13-appwrite`, leave the verified implementation uncommitted for owner review, and do not begin R5, deploy Appwrite Sites, merge to `main`, or modify `local-mvp-v1`.

Live Schema V4 is authoritative and sufficient. No Schema V5 or live schema mutation is authorized. If a genuinely missing persisted field is discovered, stop and report before changing schema.

## Frozen scope

R4 delivers trusted Receipt upload, private content delivery, creator-only removal, Appwrite Storage integration, full image validation/decoding, reservations and quotas, recoverable upload/remove sagas, automatic three-calendar-month retention, the bounded `maintenance` Function, orphan/quota reconciliation, binary-inclusive manual backup/restore, browser integration, capability rollout, and proportional provider/live acceptance.

R5 deployment, final release/security closure, monitoring, domains, merge/tag work, and any registration/authentication redesign are excluded.

## Owner-approved implementation decisions

- Reservation TTL: one hour.
- Completely untracked Storage-file grace: 24 hours.
- Expense commands commit before separate Receipt sagas; partial success must be stated accurately and failed Receipt drafts retained where safe.
- Full server decoding uses pinned `sharp`/libvips after the existing structural validator.
- Command outcomes do not expire in R4.
- Backup remains manual operator tooling and includes retained binaries.
- Existing V4 `receipt_metadata`, `receipt_reservations`, `command_outcomes`, `coordination_guards`, private `receipts` bucket, and `maintenance` Function are sufficient.

## Security and privacy

The browser never receives a runtime/Storage API key, `storageFileId`, broad Storage URL/token, or direct delete authority. The existing bucket retains File Security, no public/client permissions, the 10 MiB limit, and JPEG/PNG/WebP allowlist.

The Expense creator may read private metadata/content, upload, and remove. A historical uploader may read only their own historical Receipt. Other Household members receive one generic attachment projection only. Leader status adds no authority. Unauthorized, foreign, terminal, or guessed identifiers fail as privacy-safe `NOT_FOUND`; non-private responses never contain Receipt ID, filename, MIME, size, uploader, lifecycle, checksum, Storage identity, URL, or bytes.

## Upload and removal delivery

Both `upload-receipt` and `remove-receipt` use actor + command type + command ID + SHA-256 canonical intent. Upload intent includes authoritative server-computed content checksum, byte length, declared/detected MIME agreement, Expense ID, and normalized private filename where present. Removal intent binds the authorized Receipt ID. Same key/same intent returns the original sanitized outcome; changed intent returns `IDEMPOTENCY_KEY_REUSED`.

Upload uses domain-separated deterministic reservation, metadata, and Storage IDs. It authenticates, performs a bounded read and checksum, authorizes the creator, resolves replay, transactionally reserves the Expense slot/uploader bytes/project bytes plus in-progress ownership, structurally validates and fully decodes, uploads to the deterministic private file, then transactionally creates metadata, sanitized audit, command outcome, and finalizes the reservation. Storage success plus database failure remains recoverable; metadata success plus lost response replays the outcome without duplication.

Removal authenticates and authorizes a known available Receipt, resolves replay, deletes the Storage binary, then conditionally transitions `available -> user-deleted`, releases capacity once, writes a sanitized audit and outcome. Storage 404 is idempotent success only after authoritative authorization. Lost responses replay success without a second deletion, audit, or capacity release. Retention/removal races preserve the first terminal transition.

## Validation and content delivery

Input must be 1 byte through 10 MiB, use an allowed declared MIME, pass the existing format-aware structural validator, match detected format to declared MIME, fully decode through pinned `sharp` with strict corruption/truncation handling, and have non-zero dimensions. Signature-only PNG, truncated JPEG, malformed WebP, contradictory MIME/content, zero-byte, and undecodable input fail before available metadata exists.

The private same-origin content route derives the session actor, reads private metadata, authorizes through the Expense/Household boundary, requires `available`, reads Storage on the server, verifies size/checksum, rereads lifecycle, and returns bytes only while still available. Headers are authoritative `Content-Type`/`Content-Length`, `Cache-Control: private, no-store, max-age=0`, `X-Content-Type-Options: nosniff`, and filename-free inline disposition. Client Blob URLs are revoked on replacement, removal, identity change, navigation, unmount, and stale async completion.

## Quotas, retention, and maintenance

Admission transactionally serializes available+reserved count per Expense, uploader bytes, and project bytes. Limits remain 3 available Receipts per Expense, 10 MiB per file, 50 MiB per uploader, 1,000,000,000 project bytes, with a private non-rejecting warning at 800,000,000. Terminal content contributes zero capacity. Parallel reservations cannot bypass limits.

Retention derives the first instant of the current Dhaka calendar month minus two months from `receipt.createdAt`. `createdAt < cutoff` expires; equality retains. Per candidate: revalidate, delete binary, conditionally transition `available -> retention-expired`, then release capacity exactly once. Storage failure leaves metadata available; missing Storage after an earlier successful delete is idempotent success for an eligible candidate only.

The existing `maintenance` Function runs bounded sequential stages: retention, stale reservations, orphan reconciliation, quota reconciliation, and terminal-reservation cleanup. It uses a non-overlapping lease, deterministic order, persisted stage cursors, page size 25, an approximately 240-second work budget within the configured 300-second timeout, and no client execution permission. Command outcomes are not pruned.

Expired reservations inspect the deterministic file and either reconcile/finalize legitimate completion or remove the orphan before releasing capacity. Files with no metadata or reservation are removable only after 24 hours. Quota reconciliation treats available metadata plus active reservations as authoritative and never touches financial data.

## Backup, capabilities, and acceptance

Manual backup writes outside the repository: `rows.json`, `manifest.json`, `manifest.sha256`, and `receipts/<receiptId>.bin`. Every available metadata row must have exactly one verified binary; size, SHA-256, MIME/full decode, metadata mapping, missing binaries, terminal expectations, and orphans are checked. Restore verifies the complete backup before mutation and restores/validates binaries before available metadata.

Capabilities start with `receiptContentReads=false` and `receiptMutations=false`. Enable content reads only after privacy/content/browser gates; enable mutations only after upload, removal, quota, recovery, and browser integration gates. Automatic maintenance is capability-independent.

Live acceptance uses one small harmless real image in the existing real Household: creator upload/reload/preview/read, ordinary-member generic-only projection and denial, non-creator-Leader denial, creator idempotent removal, retained `user-deleted` metadata, inaccessible binary, and reload persistence. Retention dates and large quotas use controlled fixtures, never meaningful history or giant real uploads.

Before owner review, measure actual staged operations for reservation/finalize/removal/retention/stale cleanup against the 100-operation ceiling; run focused and full Vitest, architecture guards, ESLint, TypeScript, production build, dependency audit, diff-check, built-client secret/Storage-ID scan, Chromium, Firefox/WebKit smoke, Axe, backup verification, maintenance/provider checks, and the live Receipt journey. Appwrite Sites acceptance of the trusted 10 MiB body remains an explicit R5 blocker if no deployed Site exists.
