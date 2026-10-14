# Safari reference motion implementation — 2026-10-14

G5–G6 complete the owner's approved [Safari reference assessment](SAFARI_TAB_MOTION_ASSESSMENT_2026-10-14.md) locally. The [actual gallery](safari-motion-implementation-2026-10-14/index.html) includes normal-speed desktop/mobile recordings and paused native phase captures. No deployment or provider/data operation occurred.

## Change and scope

One persistent selection now owns its fill, rim and clipped navigation foreground. Original active controls no longer paint a second black destination ahead of the moving selection. The visual expands, travels as translucent dark glass, briefly compresses, rebounds and settles. Forty-one native geometry keyframes sample a damped response; duration is 560–660ms according to travel distance. A retarget begins from the visible box and material opacity. Matching inverse foreground transforms keep text/glyph centers aligned while the selection travels.

Only existing authored navigation label/glyph/badge wrappers are copied into an `aria-hidden`, pointer-transparent clipped foreground. Controls, IDs, financial pages and forms are not copied. The foreground has no links, inputs, buttons or tab stops. White ink and a dark tint of at least 0.66 retain contrast during travel; a small clipped magnification and rim highlight approximate the optical detail. This does not implement or claim Apple's full native refraction.

The approved capsule bounds, ordinary logo/bell/profile, sidebar, mobile destinations, periwinkle Add, page layouts, routes, active semantics and callbacks retain their existing behavior. Fine-pointer desktop hover is mirrored in the clipped ink; mobile has no hover. Reduced motion, viewport changes and unmatched destinations cancel/snap/hide selection as appropriate. Resize/mutation observation reconciles fonts and badges without canceling a just-started animation. Effect/listener/observer cleanup remains bounded to the navigation surface. Financial drafts are never remounted, captured or persisted by motion.

## Acceptance evidence

| Check | Current evidence |
| --- | --- |
| Unit suite | 924 tests / 117 files pass. |
| Static checks | Final TypeScript and lint pass. |
| Local optimized build | Pass. |
| Browser UI/mobile/navigation | 72 cases pass: Chromium 24, Firefox 24 and WebKit 24. |
| Final in-flight harness replay | Four additional Chromium/Firefox cases pass after the test-only pause instrumentation; WebKit and iPhone already passed with that instrumentation. |
| Optimized touch profiles | Android Chromium 12 and iPhone WebKit 12 cases pass. |
| Desktop preservation | 68/68 protected raw comparisons match decoded pixels; all image dimensions match. |
| Appwrite build and intercepted sessions | Optimized build and 36 session cases across three engines pass; unmatched API traffic is aborted, with explicit synthetic fixtures only. |

The desktop reference reuses the accepted G1–G3 after captures; historical evidence is retained. The protected region is the entire standalone/auth/404 image, or `x >= 96, y >= 112` on shell views, excluding only navigation and its bounded shadow margin. This phase introduces no additional raw pixel differences in that protected region. Full images are expected to differ in the owner-approved navigation selection.

The 457-file source baseline changes only `src/app/glass-navigation.css`, `src/presentation/shell/glass-selection.tsx` and the mobile caller's visual-selector prop. The other 454 existing files, including all protected financial, persistence, API, runtime, page and chart source, remain unchanged. Dependency manifests and existing global/mobile styles remain unchanged. Earlier approved mobile/glass work is preserved.

## Harness repairs and limitations

- Grouping an individual-scale reset with the existing reduced-motion transform reset serialized a control's neutral transform as an identity matrix. Scoping the individual-scale reset to the copied ink restored the original neutral representation; the six-case Chromium replay passed.
- Reduced-motion media changes and CSS effects settle asynchronously. Assertions poll for zero effects across the selection subtree; they retain the zero-animation requirement.
- The new hit-area comparison initially ran before the two fixture badges arrived, changing two tab widths by 24px. It now waits for the real badge state and fonts before measuring, retaining exact hit-area equality. The iPhone replay passed.
- Slow WebKit protocol/paint timing could finish a real animation before the test paused it. Test-only instrumentation now pauses each native selection effect as it is created. The same real keyframes, geometry, material, clipping and contrast are inspected; no hook is added to application code.
- A user interruption stopped the temporary servers partway through acceptance. Services were restored and incomplete checks resumed. A concurrent cold development-server run timed out during fixture setup; warmed sequential verification retains the full assertions.
- One standalone capture included a Next development issue badge generated by screenshot caret/hydration timing. A test-only capture rule excludes development tooling for that image; all 68 protected comparisons then pass. Application auth source remains unchanged.
- Concurrent build/development type generation left duplicate trailing declarations in ignored `.next/dev/types` files. The invalid cache was preserved outside the checkout, and the build/type checks passed with the owned development server stopped. The local preview was then restored with fresh development types. No application or TypeScript configuration change was required.

## React and lifecycle review

The changed component uses primitive effect dependencies and refs for native animation; it introduces no fetches, frame-driven React state, domain callbacks or duplicate financial forms. Route changes retain one mounted visual and retarget its visible geometry. Resize/mutation observers and media/pointer listeners are disconnected on cleanup; native effects are canceled on completion, snapping and unmount. Copied navigation ink is hidden from assistive technology and contains no controls or IDs. Original links retain active semantics, focus, hit areas and commands. The mobile caller adds only its authored icon selector. The review found no further application change necessary.

Native phase captures are deliberately paused inspection samples, not user-facing app states or frame-rate benchmarks. Actual recordings use normal playback. Emulated profiles and browser engines do not establish physical iPhone/Android GPU performance. Detailed manifests, configs, logs, traces and captures are retained at [the local evidence directory](<C:/Users/raiya/.codex/visualizations/2026/10/13/01a13607-5fba-7aa3-850c-43766afdcee2/safari-motion-implementation-2026-10-14>).
