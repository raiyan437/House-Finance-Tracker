# Color concepts — 2026-10-14

Design-only C0, requested by the owner after feedback that the app lacks color. The [gallery](index.html) contains seven final boards / fourteen desktop-mobile views: Dashboard, Expenses, Add Expense, Settlements, My Cards, Household and Monthly Report. All were generated with the built-in image_gen tool using fourteen actual synthetic application screenshots, plus the first Dashboard board as a palette/style reference. No paid project service, API-key workflow or application implementation was introduced.

## Palette and intent

| Role | Proposed color | Use |
| --- | --- | --- |
| Accent | `#5668CF` | Indigo headings, selected-field details and supporting icon accents. |
| Soft accent | `#DCE4FF` | Spending summaries, filter groups and selected options. |
| Supporting teal | `#217B75` | Supporting section icons and categorical Card chart series. |
| Soft mint | `#E0F2EC` | Contributions, member sections and receivable summaries. |
| Amber | `#E6AA3D` | Decorative accents and pending-state details. |
| Soft amber | `#FFF1CE` | Pending/join-request headers and caution fills. |
| Canvas | `#E2E6EB` | Existing pearl-gray foundation. |
| Surface | `#F9FAFC` | Existing near-white readable panel bodies. |
| Primary/selected | `#080909` | Existing black action buttons and active navigation. |

Green/red financial meanings and explicit text labels remain. Zero remains neutral. Supporting mint does not mean a pending payment is confirmed. Cash/Card charts propose a consistent indigo/teal categorical pair, with labels and amounts preserved. Amber is not a small-text color on white: retain the existing dark warning foreground or a verified readable equivalent. Raster colors/text do not themselves certify runtime WCAG compliance.

## Scope and matching contract

- This is a color-placement proposal, not approval for implementation or a new desktop/mobile design. Keep the approved responsive layouts, original controls, breakpoints, financial forms, data/chart series, focus, hover/touch behavior and glass motion. Desktop glass stays within the center navigation capsule and compact rail; the logo/bell/profile are outside it. Mobile keeps the five original destinations.
- Desktop/mobile must share the same palette and financial meanings. The proposal makes tints visible above the fold through existing summaries, filter groups and section headers. It does not require all panels to become colored or a replacement of every black primary action.
- Existing business/session/provider/permission rules remain authoritative. No automatic payment, transfer, banking connection, new currency/category filter, export or Credits route is introduced. Household disabled actions stay disabled; a generated red treatment must not make them appear enabled in implementation.
- Cropped/compact mobile samples do not remove offscreen sections, fields, uploads, confirmations, participant controls, or Summary/Create actions. Actual current source and reference screenshots govern their geometry, overflow and interaction. The Add Expense participant chips are compressed in the illustration; preserve the implemented phone layout if a later color-only phase is approved.
- Generated glyphs, badge counts, chart icons, small copy, dimensions and data rendering can be approximate. The Monthly Report desktop rail glyph is approximate; retain the actual Dashboard grid icon. Cards' decorative background circles are illustrative; they are not a requirement to change the existing canvas. Do not implement any incidental graphic or text error.
- The route rules govern active selection: Add is active on phone Add Expense, Settlements on its page, More on Cards/Household, and Monthly Report has no matching selection. Targeted image edits corrected copied Dashboard selections and the report's Card series palette. Tiny omitted badges must remain implemented from real runtime data.

## Files and evidence

Final images are `dashboard.png`, `expenses.png`, `add-expense-v2.png`, `settlements-v2.png`, `cards.png`, `household.png` and `monthly-report-v2.png`. All are saved beside this README; full-resolution links appear in the gallery. Fourteen original screenshots are saved in `references/`. Three superseded correction targets remain in `drafts/`.

The exact [generation prompts](PROMPTS.json), [refinement prompts](REPAIR_PROMPTS.json), [initial generation manifest](GENERATION_MANIFEST.json), [final selected-file manifest](FINAL_MANIFEST.json) and [source preservation result](VERIFICATION.json) are retained. All 457 baseline application source files remain byte-identical; no source file is added. The baseline manifest is stored at `C:/Users/raiya/.codex/visualizations/2026/10/13/01a13607-5fba-7aa3-850c-43766afdcee2/color-concepts-2026-10-14/source-before.json`.

These mockups are proposed for review. Frozen requirements and application colors remain unchanged.
