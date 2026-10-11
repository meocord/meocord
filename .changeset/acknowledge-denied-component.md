---
'meocord': patch
---

A button, select menu or message modal whose guard returns `false` is now acknowledged invisibly, with or without `@Defer`, so the user no longer sees "This interaction failed". The call still reports `ran: false`, and observers still see the outcome `'denied'`. A command, and a modal opened by a command, are left as they were: their only acknowledgement is a reply of their own.

A test that expects `getResponse(interaction).calls` to be `[]` after a denied click now sees `['deferUpdate']`, as a test of a handler with `@Defer` already did.

A guard that answers the click itself before returning `false` should await that answer. A reply still on its way when the guard returns races the acknowledgement, and Discord refuses whichever comes second, possibly the reply.

An app with both a route and a collector for one customId, where the guard returns `false` so the collector answers the click, should leave the click to one of them. Otherwise the two acknowledgements race, and the collector's can fail with "already acknowledged".
