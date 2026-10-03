# Bounded braces fork

This private, MIT-licensed fork retains the runtime source of `braces@3.0.3`
(https://github.com/micromatch/braces/tree/3.0.3) and its original LICENSE.
It fixes GHSA-vfj7-8cjw-p6xm / CVE-2026-93687, for which no upstream patched
release was available on 2026-10-03. Its distinct package name identifies
maintained local code; it does not claim to be an upstream patched release.

The root npm override installs this source as `braces` for every consumer,
including micromatch, fast-glob, Next ESLint, and shadcn tooling. No audit
exception, severity filter, or downgrade is used. `npm ci` installs the fork
from the committed source without a postinstall patch or external registry.

## Patch contract

- A fixed 128-level ceiling bounds parser nesting (braces and parentheses),
  recursive compile/expand/stringify walks, expansion ancestry traversal,
  append recursion, and flatten recursion. Options cannot raise the ceiling.
- Over-depth patterns or external ASTs fail explicitly with a `SyntaxError`
  containing `nesting exceeds the safe limit`, before native stack exhaustion.
  Cyclic child/parent ASTs also reach this fixed guard rather than looping.
- Escaped, quoted, and bracket-contained characters retain upstream parsing;
  normal glob alternatives, ranges, options, and public/direct-lib APIs remain.
- No application request, financial logic, CSS, or lint rule is replaced.
  The only intentional tooling behavior change is rejecting unsafe nesting.

Security and compatibility coverage lives in
`src/architecture/bounded-braces.test.ts`, including installed dependency
resolution and representative fast-glob/micromatch operations. Remove this
override and directory when an upstream fix can pass these regressions and
the unchanged strict audit. Do not bump the local version to impersonate
an upstream release or remove tests merely to make an audit pass.

## Source delta

Added `lib/depth.js`; added guards to `parse`, `compile`, `expand`, `stringify`,
and `utils.flatten`. Other upstream runtime files are unchanged. Package
metadata is reduced to the private fork identity and required `fill-range`
dependency. Original license and copyright are retained.
