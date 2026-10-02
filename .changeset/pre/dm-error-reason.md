---
'meocord': patch
---

The direct message `messages.dmOnError` sends for a command in a server now says what went wrong. `meocord.dm.error` reads `{command} in {channel} on {server}: {reason}`, where `{reason}` is what the fallback answers the error with: "An error occurred while executing the command." for a fault, and "Cooldowns can't be checked right now: try again shortly." when the cooldown store is down. It said "Something went wrong running {command} in {channel} on {server}. Try again later." for both, so a store outage read as a broken command. The text has the same shape as `meocord.dm.cooldown` beside it. A catalog that translates `meocord.dm.error` adds `{reason}` to it.
