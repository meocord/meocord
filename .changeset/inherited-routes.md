---
'meocord': minor
---

`@Controller({ inheritedRoutes: 'replace' })` makes a handler the class re-decorates answer only the routes the class declares for it, dropping the ones its base classes declare for that method. That covers every kind: commands, component patterns, message patterns and listeners, reactions and autocompletes. A slash or context menu command that no handler answers any more is not registered. A method overridden without decorators keeps every route it inherits. `'keep'`, the default, answers both, as before; the next major version (5.0) replaces them by default.

Two things help with the move, without changing what a bot does:
- The warning that names a re-declared handler still answering an inherited route now says how to drop that route now.
- `inspectHandler` reports the routes a handler answers by inheritance, as `inheritedRoutes`.

See https://meocord.dev/docs/4.2/how-a-call-runs.
