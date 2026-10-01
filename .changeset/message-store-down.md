---
'meocord': patch
---

With `messages.dmOnError` on, a message command refused because the cooldown store is down now DMs its author, once per outage, the `meocord.dm.error` message, or `meocord.cooldown.storeDown` for a command sent in a DM. Such a command got no answer at all, so while the store was down every `!command` with a cooldown looked like a dead bot. Without `dmOnError` it is still skipped silently, as before.
