---
'meocord': minor
---

`applyDecorators(A, B)` now applies its decorators as `@A @B` does, stacked in the order written: `B` first, then `A`. It applied them the other way round, so guards listed in it ran in the reverse of the order written, and moving stacked decorators into `applyDecorators` changed what ran first. A method or class a decorator returns in place of the one it was given, as a wrapping decorator does, now reaches the next decorator and TypeScript; it was dropped.

`applyDecorators(UseGuard(A), UseGuard(B))` now runs `A` before `B`. To keep 4.0's order, write `applyDecorators(UseGuard(B), UseGuard(A))`. The same holds for interceptors, pipes and filters composed this way. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#applydecorators-applies-its-decorators-in-the-order-they-stack).
