---
'meocord': patch
---

With `messages.dmOnError` on, a message command refused because the cooldown store is down now tells its author privately, once per outage, as the `meocord.dm.error` message (or, in a direct message, `meocord.cooldown.storeDown`). Such a command got no answer at all, so while the store was down every `!command` with a cooldown looked like a dead bot. Without `dmOnError` it is still skipped silently, as before.
