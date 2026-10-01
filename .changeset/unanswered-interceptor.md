---
'meocord': patch
---

`warnUnanswered` now also warns when an interceptor returns without calling `next.handle()` and leaves the interaction unanswered, or deferred by `@Defer()` with no follow-up, as an interceptor that answers from a cache can. The warning names the interceptor: `Shop.buy: its interceptor Cached returned before the handler ran, without answering the interaction, …`. It warned only when the handler itself ran, so this case passed silently while the user saw "The application did not respond".

An interceptor that returns before the handler finishes, as one racing `next.handle()` against a timeout does, is named the same way, `… returned before the handler finished, …`, rather than the warning blaming the handler for an answer it was still about to send.
