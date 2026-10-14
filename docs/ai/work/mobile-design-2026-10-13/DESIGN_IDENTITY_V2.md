# Same web identity, mobile layout — version 2

**Implementation approval, 2026-10-14:** the owner accepts this direction and authorizes local M1–M4 implementation, with unchanged desktop appearance and explicit removal of Icon Credits. The generated Credits view below is excluded. See the [implementation verification record](../MOBILE_IMPLEMENTATION_VERIFICATION_2026-10-14.md) and [actual mobile capture gallery](../mobile-implementation-2026-10-14/index.html). The M0 revision/history below retains its original scope.

Revision completed on **2026-10-14, Asia/Dhaka**. The owner clarified that mobile must follow the praised web design and feel more like an app through layout changes. The initial six boards are superseded as the current design direction; they remain retained for history. This is an M0 design-only revision, with no application implementation, deployment or production-data change.

## Visual authority

Actual desktop screenshots supplied to imagegen are the visual references. The [gallery](index.html) shows those screenshots beside the revised boards. The [version 2 prompts](PROMPTS_V2.md) record reference roles, palette, page requirements and illustration corrections. The previous [gallery](index-v1.html) is historical, not an alternate approved theme.

| Preserve from web | Adapt for mobile |
| --- | --- |
| Gray `#E2E6EB` canvas with the existing lower blue-gray wash `#CDDBF0` | Phone gutters and compact header placement |
| Pale grouped surfaces and near-white `#F9FAFC` inset panels | Content-sized vertical panels with smaller gaps/padding |
| Black `#080909` pill primary actions and selection | Reachable bottom navigation and short action rows |
| Inter, black primary text, existing muted text and separators | Readable phone inputs and wrapping metadata |
| Existing peach/mint initials, colored category PNGs and utility icons | Smaller avatar arrangements and internally scrolling category strip |
| Muted blue/coral charts and green/red signed balance pills | Full-width charts and legible ticks without changing data |

Use the existing implementation's exact tokens, opacity and component assets when implementing. The table is a matching brief, not a replacement stylesheet or new palette. Preserve the grouped/inset surface family without retaining wasteful desktop-sized empty space.

## What “app-like” means here

- Compact, predictable header and thumb-reachable controls.
- Expense list content visible soon after search/month controls; existing live filters can move into the proposed mobile sheet.
- Current balance information readable early in the Dashboard, followed by all existing analytics modules.
- One scrolling Expense form with compact sections, full live summary, explicit Cancel/Save, all split/receipt/privacy controls and retained draft/error handling.
- Short confirmations and a proposed scrollable full-height sheet for long Card forms, with existing focus and pending-operation semantics.
- Existing five destinations and authority. This is a responsive web app; it does not add a native app, installed-app behavior, push, new gestures or new financial actions.

## Revised board coverage

1. [Everyday money](concepts-v2/01-everyday-money.png): Dashboard, Expenses, Add Expense and Expense Details.
2. [Review and settle](concepts-v2/02-review-and-settle.png): Settlements, Monthly Report, Notifications and Edit Expense (image order differs from version 1).
3. [Cards and household](concepts-v2/03-cards-and-household.png): My Cards, Add/Edit Card, Leader/Member Household and Profile.
4. [Household onboarding](concepts-v2/04-household-onboarding.png): no-household, Pending, Create, Join and standalone Credits.
5. [Authentication](concepts-v2/05-authentication.png): Sign In, Create Account, recovery and new password.
6. [Mobile interactions](concepts-v2/06-mobile-interactions.png): More, proposed Filters sheet, receiver confirmation, 404 and Dashboard analytics continuation.

## Illustration acceptance limits

The revised set matches the web palette, panels, buttons, initials, category treatment and chart colors more closely. It is still a raster design reference rather than an exact implementation specification. Card-board navigation was corrected to restore Add in the middle; Credits was corrected to remove invented authors/categories and show an excerpt from the actual attribution register.

Do not copy remaining incidental image differences into the application:

- The navigation remains **Dashboard grid, Expenses, Add, Settlements, More**, icon-only. Preserve existing active-route rules, badges and destinations; sample glyph substitutions or highlight positions in another board are not a route change.
- OS status-bar symbols appearing in the review/settlement board are illustrative and must not be drawn into the web app.
- The category row remains all twelve existing assets in canonical order, one internally scrolling row. The Edit illustration's wrapped categories are not the intended layout.
- Preserve participant selection and read-only equal shares; rendered amount boxes do not authorize changing equal allocations. Keep original summary fields, receipts, privacy text, activity details, comments textarea/explicit Send, warnings and all below-viewport continuation content.
- Preserve Expense status/comments-before-date semantics, immutable payer and exact financial-history/permission rules. Generated row order or missing controls do not amend them.
- Report and Dashboard charts use the selected calendar month, including all days and zero days. The analytics illustration's “last 31 days” wording is inaccurate; use the existing selected-month copy and actual derived series. Drawing geometry is not evidence of money reconciliation.
- Keep standalone auth/Credits/404 navigation behavior, actual source attribution links and actual assets. Only current owner-private metadata appears on Profile/Cards. The illustrative Member header must use the actual current viewer's identity.
- Use existing recovery/session behavior, exact field validation, quotas and allowed dates. No new feature, permission, validation rule or provider operation is introduced.

## Desktop protection and verification

The application, shared CSS, domain/application/persistence/API code, dependencies and desktop layout are unchanged in this revision. Only review documents, versioned images, prompts, desktop reference captures and the static gallery were added/updated. Original browser-inspection evidence remains valid; no new application verification is claimed.

Gallery verification checks all local image/link targets and horizontal fit at 390/1440px. A future approved implementation must scope mobile layout styles, retain one mounted form/data flow and verify desktop parity at 1024/1280/1440/1920px. The M1–M4 implementation gates in the original audit remain recommendations awaiting acceptance, not current authorization.
