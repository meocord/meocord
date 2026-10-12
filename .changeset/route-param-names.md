---
'meocord': patch
---

The types read a customId pattern's params as the runtime does: a `{name}` or `{name:type}` whose name is ASCII letters, digits and `_`. A brace pair such as `{café}` is literal text, as `route()` already treats and warns about it, so `RouteParams<'x/{café}'>` is `never`, `route('x/{café}').build()` compiles, and `build({ café: '1' })`, which compiled and then threw, no longer compiles. A `@Command` handler that declared such a param, and received none, no longer compiles either.
