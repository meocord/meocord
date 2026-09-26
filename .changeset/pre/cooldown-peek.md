---
'meocord': minor
---

`CooldownStore.peekMany(entries)` checks a call against its cooldowns without recording it, returning the verdict `consumeMany` would. `MemoryCooldownStore`, `ShardedCooldownStore` (one message to the shard manager) and `RedisCooldownStore` (one read-only script; on Redis Cluster, one per slot unless `hashTag: 'handler'` keeps a handler's keys in one) answer it from their counts. A store of your own needs nothing: the default allows every call and leaves the refusal to `consumeMany`. Override it to let a cooldown refuse a call before the work ahead of its handler. `testCooldownStore` checks an override: a peek records nothing and refuses with the wait `consume` gives.
