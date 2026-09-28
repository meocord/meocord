---
'meocord': minor
---

A message command can tell its author, in a direct message, what the channel doesn't show. Without a filter, a message command's unexpected error is only logged and a cooldown refusal is skipped silently, since a reply in the channel can't be private. Two options turn on a direct message instead, both off by default:

- `@MeoCord({ messages: { dmOnError: true } })` tells the author the command failed, naming the command, the channel and the server. The error is still logged.
- `@MeoCord({ messages: { dmOnCooldown: true } })` tells the author how long to wait, once per wait: retries before it ends send nothing more. The notice is counted in the app's cooldown store, so it holds across shards with a shared store.

Only patterned message handlers are answered, and only when no filter handled the error. A command sent in a direct message is answered there. A member whose direct messages are closed is not told, at debug level. Guard, validation, usage and `UserError` replies are unchanged. The texts are `meocord.dm.error` and `meocord.dm.cooldown`, translatable like MeoCord's other texts, in the server's language.
