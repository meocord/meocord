---
'meocord': patch
---

Routing fixes for handlers that compete for the same interaction:

- **Two `@Autocomplete` handlers for one option are named at startup.** Two handlers that complete the same option of a command, or every option of one path, used to start silently, and the first controller listed always won. The warning about command handlers that never run now names the one that never does, and the one that runs instead. Handlers of an option Discord never asks to complete are named for that alone. The bot still starts. In 5.0, it refuses to start.
- **The warning about overlapping component patterns names the handler that runs.** For each pair of patterns that can match the same customId, such as `a/{x}/c` and `a/b/{y}`, it now says which handler runs for the ids both match, and why: the more specific pattern, or between equally specific ones, the one whose controller is listed (or handler declared) first, as in 4.0. Where the next major version (5.0) runs the other one instead, preferring the pattern that spells out the first segment where the two differ, the warning says so, and what to do so the bot does the same before and after: list that handler's controller (or declare that handler) first, or make the patterns distinct.
- **The overlap warning is given once, as the bot starts.** It is a startup check like the others: `meocord start`, `meocord register` and the shard manager give it once, where each process-sharded shard gave it again, and `MeoCordTestingModule.compile()` gives it without anything being dispatched. Two handlers whose patterns match exactly the same customIds are refused there too: by the shard manager before it spawns a shard, and by `compile()`, where `invoke()` rejected.
- `@Command`'s documentation now says that only patterns matching exactly the same ids stop the bot, that overlapping ones are warned about, and how 5.0 breaks a tie. `@Autocomplete`'s names the two startup warnings about its handlers.
