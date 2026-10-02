---
'meocord': minor
---

Fixes in `meocord/common`:

- **A send Discord could not read is logged as an error.** When a reply, an edit, a direct message or an acknowledgement fails, MeoCord still logs a refusal for something Discord reports at debug level, such as a missing permission, an interaction already answered or a message already gone. A body Discord could not read is logged as an error with its cause: an invalid form body (`50035`), invalid JSON (`50109`) or an empty message (`50006`). Only the code that built the request can fix those, and they were logged at debug, where they went unseen.
- **`RedisCooldownStore` on Redis Cluster counts a call against all of a handler's keys or none.** When a handler's cooldowns sit in different slots, each key is counted by a script of its own. If a later key's script fails, the uses already counted are now given back before the failure is reported, so the call does not leave earlier keys counted for a call that was refused.
- **`RedisCooldownStore`'s error for a reply it cannot read** describes the reply it expects, including the wait's end on a refusal.
- **`meocord/common` exports `ResponseLockOptions`**, the options `respond(interaction).lock()` takes, so a helper that passes them on can type them.
- **`MemoryCooldownStore` keeps its key count and its sweep to itself.** It dropped expired keys once a minute through a public `sweep()`, beside a `size` getter, both of them for MeoCord's tests. Neither is part of the store's API, and code that called them uses the store as any other `CooldownStore`.
- **A catalog's `meocord` group with a text where MeoCord has a group** is refused with one message naming it, such as "meocord.usage is a group, not a text", where it named every property of a string.
