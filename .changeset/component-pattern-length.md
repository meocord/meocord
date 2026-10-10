---
'meocord': patch
---

`@Command` warns, naming the handler, about a component pattern no customId can match: one that is empty, or whose shortest customId is over Discord's 100 characters. Such a handler never runs; the bot still starts. `route('').build()` throws a RangeError, as it does for an id over 100 characters, rather than returning an empty customId Discord refuses.
