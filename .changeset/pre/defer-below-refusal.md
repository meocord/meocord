---
'meocord': patch
---

`@Defer()` written below `@MessageHandler`, `@ReactionHandler`, `@On` or `@Autocomplete` is refused in one line at `create()`, as it is when written above one, rather than printed with a stack trace.
