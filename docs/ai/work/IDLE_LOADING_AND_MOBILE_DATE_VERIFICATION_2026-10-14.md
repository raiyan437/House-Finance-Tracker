# Idle loading and phone Expense date — 2026-10-14

F1–F3 implement the owner's two requested fixes locally. The reverted C1–C3 colors remain withdrawn.

## Result

- A returning production tab shows the existing animated page skeleton/spinner while the original session check runs. Main content is marked busy and its existing route surface becomes hidden/inert; its page/form tree stays mounted. The topbar, sidebar and phone navigation stay usable. Ready content returns after the check, with the same draft input node/value. The existing unavailable banner/Retry, expiry invalidation and write/uncertain-response safeguards remain.
- Expenses and Settlements use the shared animated loading component for their existing route-data waits. Cards, Dashboard and other existing route loaders remain. No artificial delay, new loading timer or command replay is added.
- A single rule inside the existing below-640px phone stylesheet gives the Expense Date a full flex row after status/comment count. All dates, payer/payment/split metadata and actions remain. Desktop/tablet metadata is unchanged.

Actual synthetic screenshots: [phone Expense list](idle-loading-date-fixes-2026-10-14/expenses-phone.png), [desktop Expense list](idle-loading-date-fixes-2026-10-14/expenses-desktop.png), [phone idle loader](idle-loading-date-fixes-2026-10-14/idle-loader-390.png), [desktop idle loader](idle-loading-date-fixes-2026-10-14/idle-loader-1440.png), [phone Expenses loading](idle-loading-date-fixes-2026-10-14/expenses-loader-390.png), [desktop Expenses loading](idle-loading-date-fixes-2026-10-14/expenses-loader-1440.png), [phone Settlements loading](idle-loading-date-fixes-2026-10-14/settlements-loader-390.png), [desktop Settlements loading](idle-loading-date-fixes-2026-10-14/settlements-loader-1440.png).

## Verification

| Boundary/check | Evidence |
| --- | --- |
| Resume event → existing bootstrap check → loader → ready | New held-response tests pass in Chromium, Firefox and WebKit. Coalesced focus/pageshow/visibility events keep one refresh; the checking banner is absent. |
| Draft preservation | The actual Profile input remains the same DOM node, hidden/inert during loading and restored with its unsaved value. Expense/Profile/password drafts retain their existing regression coverage. |
| Navigation → delayed destination data → page | Held session and Expenses/Settlements API responses prove topbar, sidebar and phone navigation stay usable. Selecting Settlements before Expenses finishes remains interruptible. Each page displays its animated loader until its own response arrives. |
| Session/write boundaries | All 45 intercepted production-session cases pass across three engines without retries: startup recovery, outage/Retry/online recovery, expiry removal, 403 without logout, retained uncertain command IDs, no automatic mutation replay and successful-save/failed-refresh handling. Unmatched API requests abort before reaching a provider. |
| Local responsive/motion flows | All 30 cases pass without retries across three engines: phone date geometry at 360/390/430px, tablet/desktop at 768/1440px, controls, filters, mounted percentage drafts, glass tab/Back interruption, stationary phone hit areas and reduced motion. |
| Focused unit coverage | 45 production runtime/transport/navigation tests pass, including the new mounted-draft loader case and stale-command write blocking while visually hidden. |
| Accessibility/reduced motion | Both Expense list scans and the held idle-loader scan in each engine have zero serious/critical Axe findings. Normal spinner animation remains infinite; reduced motion follows the existing one-iteration CSS policy. |
| Desktop preservation | Expense-list geometry is exact and its protected page-content pixels are identical. The raw image has 76 differing pixels confined to the unchanged profile-avatar area (`x=1366..1410`, `y=22..52`); whole-screen pixel equivalence is not claimed. |
| Static/builds | Final TypeScript, lint, whitespace and both optimized local/Appwrite builds pass. |

The full flow is tab resume or original Link click → existing session/read endpoints → trusted response → loading/ready presentation. Production tests use an abort barrier and intercepted synthetic responses, not live Appwrite mutations or production-data acceptance. Local responsive cases retain real IndexedDB fixtures. Physical-device and screen-reader testing is not claimed.

## Scope and review

Five application files change: AppShell, production runtime render markup, Expenses/Settlements loading markup and the phone stylesheet. One runtime unit-test file and two browser-test files change. Of 457 baseline source files (including colocated tests), six change and 451 remain byte-identical. The production runtime logic before render is identical; restoring only the loader imports/markup makes both page sources exactly equivalent to baseline. Glass selection, glass/global styles, domain/application/provider/storage code and package/lock/Next/Playwright configurations remain unchanged. See [source preservation](idle-loading-date-fixes-2026-10-14/source-audit.json) and [desktop/scan comparison](idle-loading-date-fixes-2026-10-14/comparison.json).

React review confirms stable mounted children, no keyed form replacement or frame-driven state, existing effect/observer cleanup, reduced-motion behavior and nav-independent loading. The page entry effect waits until the loading state clears rather than animating a hidden surface. The transport and session state machine are unchanged.

The first unit run exposed three existing test queries that assumed checking content stayed visible or waited for the old banner text. They now address a hidden stale probe when testing the command boundary, or wait for the real loading status to clear. All original command/expiry/ID assertions remain. Initial new-test TypeScript errors (`exact` in Testing Library options and BigInt literals under the current target) were corrected in test syntax without configuration or application changes. Final checks pass. Original logs are retained.

Detailed snapshots, configs, final/failure logs, API fixture captures and proof scripts are retained in [the evidence directory](<C:/Users/raiya/.codex/visualizations/2026/10/13/01a13607-5fba-7aa3-850c-43766afdcee2/idle-loading-date-fixes-2026-10-14>). The owned optimized fixture server is stopped and the local preview is restored. No commit, push, deployment, dependency or provider/data operation is performed.
