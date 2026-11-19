---
'meocord': patch
---

A new app from `meocord create` runs its tests on a machine with Bun and no Node.js again. vitest 5.1.1 starts each test worker in a way Bun can't yet run (oven-sh/bun#33593), so `test` and `test:coverage` stopped before any test with `TypeError: child.channel?.unref is not a function`. The template now asks for vitest and `@vitest/coverage-istanbul` at exactly 5.1.0, unlike its other dependencies, which take the latest release. That holds until a vitest release carries vitest-dev/vitest#12039 or a Bun release ships `channel.unref`. An existing app with vitest 5.1.1 can set both packages to `5.1.0` in its `package.json`, or run its tests with Node.js installed.
