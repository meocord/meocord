---
'meocord': patch
---

A mention of the bot starts a message command in an app whose handlers all have their own prefixes, when `mention` is on. Such an app took no mention, since it read no starts at all, and did not prefer a handler whose `scope` fits where the message was sent. Its prefix function is still never called, since no handler uses the app's prefixes.
