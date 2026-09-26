---
'meocord': patch
---

`@Defer({ mode: 'auto' })` acknowledges an interaction without a creation time after its delay, 1.5 s unless `after` says otherwise, instead of at once. The 2.5 s cap counts from `createdTimestamp`, and without one the deadline was not a number, so the timer fired immediately. A real interaction always has one, but a test's mock did not, so a test of an auto-deferred handler saw an acknowledgement the bot would not send.

`createMockInteraction` and `createMockMessage` now give `createdTimestamp` and `createdAt`: the time an `id` the test gives encodes, as discord.js reads it, or, with the generated `id`, the time the mock was made. A `createdTimestamp` the test sets wins. Generated ids are unchanged.
