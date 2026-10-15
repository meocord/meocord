---
'meocord': patch
---

For an `@On('interactionCreate')` handler, `ExecutionContext.response` is `undefined`, as its JSDoc says for an event, and an observer's `DispatchResult.response` is `undefined` too, where it read `'unanswered'` for every such event. A guard, interceptor or filter on `@On('interactionCreate')` that answered through `context.response` now gets `undefined`: MeoCord also dispatches that interaction to its handler, which answers it. If such a stage must answer, it can do so through the interaction `context.getInteraction()` gives it. `getInteraction()` and `getMessage()` still give an event's interaction or message, and their JSDoc now says so.
