---
'meocord': minor
---

`@ReactionHandler` matches a custom emoji by its id, as well as by name. Pass the id, `@ReactionHandler('1234567890123456789')`, or the `<:party:1234567890123456789>` Discord shows when you send `\:party:` in a message. The handler then runs for that one emoji, rather than for every custom emoji called `party` across the bot's servers. A name, and a standard emoji's character, match as before.
