# Glass motion performance repair — 2026-10-14

The owner reports lag on desktop and mobile navigation, especially the mobile dock, and authorizes a local repair. G7–G9 are complete locally. The [updated recordings and phase gallery](glass-performance-2026-10-14/index.html) retains the result. No deployment, dependency or provider/data operation occurred.

## Cause and repair

The previous native animation interpolated width/height on every frame, alongside travel and nested backdrop blur. Native animation alone did not make those properties compositor-friendly. The repeated layout, paint and raster work was particularly expensive in the simulated high-density mobile profile.

The selection now has fixed layout bounds. Native transforms carry translation and expansion/compression; matching inverse scale/translation keeps clipped navigation glyph centers stationary. The existing damped response, 41 sampled keyframes, 560–660ms timing, dark tint, highlights and final black pill remain. The stationary navigation surface retains its glass blur; the moving pill no longer adds a nested blur. Layer hints are bounded to the moving selection/ink. Unchanged authored navigation ink is reused instead of cloned again on every tab/finish; badges, fonts and geometry still invalidate it. Original controls, commands, active routes, focus, hit areas and mounted forms remain authoritative.

This follows [Chrome's transform/counter-scale guidance](https://developer.chrome.com/blog/performant-expand-and-collapse/) and [rendering guidance](https://web.dev/articles/animations-guide). The implementation remains a web approximation of the accepted Safari visual rather than full native refraction.

## Repeatable renderer evidence

Both versions use optimized local builds, the same synthetic fixture, warmed routes, Chrome desktop 1440×900 and mobile 390×844 at device pixel ratio 3, and a 4× CPU slowdown. Six native replays reuse the real component's recorded effects on the actual navigation DOM after routing settles, isolating rendering from route loading. CDP timeline traces and performance counters are retained.

| Profile | Layouts before → after | Paints before → after | After compositor failure signals |
| --- | --- | --- | --- |
| Desktop, two selections | 220 → 2 | 655 → 34 | 0 of 462 signals |
| Mobile, one selection | 197 → 2 | 341 → 18 | 0 of 268 signals |

The remaining layouts are setup work rather than per-frame size interpolation. Resting comparison captures have zero changed pixels in protected content: desktop `x >= 96, y >= 112`; mobile `112 <= y < 700` CSS pixels. Navigation-edge rasterization differences remain within the approved navigation scope. This phase compares two fresh resting images; G5–G6's earlier 68-image comparison remains historical evidence rather than a newly repeated result.

Main-thread requestAnimationFrame callback p95 changes from 30 to 61ms on desktop and 55 to 31ms on mobile under throttling. These callbacks are not compositor presentation frames, and the desktop callback result is not an FPS improvement claim. Successful compositing and the removal of repeated layout/paint are the relevant renderer evidence. Emulated profiles do not establish a perfectly constant physical-device frame rate under every device/load condition.

## Verification

| Check | Result |
| --- | --- |
| Optimized renderer profiles | Both before and after desktop/mobile profiles pass without page errors. |
| Optimized browser/touch acceptance | 65 cases pass without retries: 13 each in Chromium, Firefox, WebKit, Android Chrome and iPhone WebKit. |
| Navigation unit cases | 12 pass. |
| TypeScript and lint | Pass. |
| Builds | Optimized local and Appwrite compositions pass. |
| Actual recordings/phase captures | Two recordings and eight rest/native phase images pass visual review. Gallery links and 390/1440px layouts pass with zero overflow. |

The new mobile interruption case pauses real native effects at creation, captures the visible geometry, retargets from it and checks continuity within 1px. Expanded/compressed desktop frames now assert fixed layout dimensions while visible bounds deform; inverse-scale icon centers remain within 1px. Other checks retain active semantics, hit areas, Back, no mobile hover, reduced-motion cancellation, unmatched-route hiding, Axe, More/notification overlays, dirty drafts, exact-money receiver confirmation and locked history.

The source manifest changes only `src/presentation/shell/glass-selection.tsx` and `src/app/glass-navigation.css` out of 457 existing files; no application source file is added. The other 455 source files, global/mobile styles, dependency manifests and Next/Playwright configuration remain byte-identical to this phase's accepted baseline. Earlier authorized mobile/glass work remains intact. No physical-device constant frame-rate guarantee is made.

The complete interaction story is tap/click → original Next Link → existing route/local runtime → actual active tab → persistent decorative motion. Synthetic browser fixtures retain real IndexedDB storage, draft, exact-money and history-lock checks. The motion introduces no API/data path; provider code and configuration remain unchanged.

The React review confirms primitive dependencies, refs rather than frame-driven state, bounded animation/observer/listener cleanup, navigation-only aria-hidden copies with no controls/IDs, and continuous retargeting from the visible box. Detailed logs, traces, manifests and test configs are retained in [the local evidence directory](<C:/Users/raiya/.codex/visualizations/2026/10/13/01a13607-5fba-7aa3-850c-43766afdcee2/glass-performance-2026-10-14>).

The temporary optimized server is stopped and the local development preview is restored. Its first health request exceeded 30 seconds during cold compilation; the warmed request returns HTTP 200 with the application shell. Next also reports a slow filesystem warning. Development compilation is separate from the optimized rendering/interaction evidence above.
