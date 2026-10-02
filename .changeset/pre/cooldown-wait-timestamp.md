---
'meocord': minor
---

A cooldown's wait is shown as a Discord timestamp, so a daily cooldown no longer says "try again in 1440m". The built-in answer to a blocked call, in replies, DMs and the presenter, is the new `meocord.cooldown.until` text, "Slow down: try again {when}.", where `{when}` is `<t:…:R>`: Discord words it in the reader's language and counts it down. The time is rounded up to the second, so it never reads as now while the call is still refused.

For a bot upgrading from an earlier 4.1 beta: `meocord.cooldown.seconds`, `meocord.cooldown.minutes` and `meocord.cooldown.wholeMinutes` are gone. Translate `meocord.cooldown.until` instead, keeping `{when}`.

`CooldownError` gains `retryAt`, the `Date` the next call is allowed, and `limit`, the `uses` and `windowMs` of the cooldown that blocked the call, so a filter or presenter needs no arithmetic: `time(error.retryAt, 'R')` from discord.js gives the same timestamp. Its `message`, which reaches logs and tests, stays plain text, now in the two biggest units that fit, and `cooldownMessage()` gives the same. For a wait of an hour or more that changes what it says: "Slow down: try again in 1439m." now reads "Slow down: try again in 23h 59m.", so a test that matches it changes too.
