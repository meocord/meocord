---
'meocord': patch
---

`warnUnanswered` now also warns when an interceptor returns without calling `next.handle()` and leaves the interaction unanswered, or deferred by `@Defer()` with no follow-up, as an interceptor that answers from a cache can. The warning names the interceptor: `Shop.buy: its interceptor Cached returned without running it or answering the interaction, …`. It warned only when the handler itself ran, so this case passed silently while the user saw "The application did not respond".
