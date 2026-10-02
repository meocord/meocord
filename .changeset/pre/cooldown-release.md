---
'meocord': minor
---

A call refused because the cooldown store answered too late no longer costs its caller a use. Under `cooldownStoreFailure: 'deny'`, the default, a store slower than `cooldownStoreTimeoutMs` refused the call with "try again shortly", yet its late answer still recorded it, so the retry was told to wait the whole window although the handler never ran: a `/daily` was lost. Now `@Cooldown` gives that use back.

`CooldownStore.consumeMany` may return a verdict with `release()`, which undoes the call it recorded. `MemoryCooldownStore`, `RedisCooldownStore` and `ShardedCooldownStore` give it, and `@Cooldown` calls it for any call it has already refused when the late answer arrives. A store of your own can add it to the verdict its `consumeMany` returns; one without it keeps such a call counted, as before, and `testCooldownStore` checks either. Under `'allow'`, the call ran uncounted, so the late count is its own and stays.

`RedisCooldownStore` now stores each call under its nonce alone, which `release` removes; calls recorded before the upgrade leave their windows as usual. On Redis Cluster, where a handler's keys sit in different slots without `hashTag: 'handler'`, each key is counted by a script of its own: a call counted that way is given back on every key, and a cooldown that refuses it gives back the keys counted before it, so the call counts against all of them or none, as on a single node.
