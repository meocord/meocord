---
'meocord': patch
---

Routing fixes for handlers that compete for the same interaction:

- **Two `@Autocomplete` handlers for one option are named at startup.** Two handlers that complete the same option of a command, or every option of one path, used to start silently, and the first controller listed always won. A warning now names the one that runs and the one that never does. The bot still starts. In 5.0, it refuses to start.
- **The warning about overlapping component patterns names the handler that runs.** For each pair of patterns that can match the same customId, such as `a/{x}/c` and `a/b/{y}`, it now says which handler runs for the ids both match, and why: the more specific pattern, or between equally specific ones, the one whose controller is listed (or handler declared) first, as in 4.0. Where the next major version (5.0) runs the other one instead, preferring the pattern that spells out the first segment where the two differ, the warning says so.
- `@Command`'s documentation now says that only patterns matching exactly the same ids stop the bot, and that overlapping ones are warned about.
