---
'meocord': minor
---

Cooldowns survive a failing store, and count a handler's stacked cooldowns in one step.

- **When the store fails.** `@MeoCord({ cooldownStoreFailure, cooldownStoreTimeoutMs })` decides what a call gets when the cooldown store throws, rejects or does not answer within `cooldownStoreTimeoutMs` (1000 by default).
  - `'deny'`, the default, refuses it with the new `CooldownStoreError` from `meocord/common`, which the fallback answers privately: "Cooldowns can't be checked right now: try again shortly." A filter can catch it to answer otherwise, and observers see `outcome: 'error'`.
  - `'allow'` runs it uncounted.
  - Either way the failure is logged once per outage, with its cause, and again when the store answers. MeoCord never counts a call itself or asks twice, so an answer after the timeout records the call once, in the store.
- **Stacked cooldowns, one step.** `CooldownStore` gains `consumeMany(entries)`, which `@Cooldown` calls once per call with every stacked cooldown. The default calls `consume` for each in order, so a store of your own keeps working; override it to check every entry and record the call against all of them only if all allow it. The built-in stores do:
  - `MemoryCooldownStore` checks them together.
  - `ShardedCooldownStore` sends one message to the manager.
  - `RedisCooldownStore` runs one script, so a call costs one round trip however many cooldowns it has: with 3 stacked and 5 ms to Redis, about 5 ms instead of 16. On Redis Cluster, where a handler's keys sit in different slots, it counts them a script each, in order, unless you pass `{ hashTag: 'handler' }` to keep each handler's keys in one slot.
  - With these stores, a call one cooldown refuses no longer spends the others, and waits the longest wait among those that refuse it.
- **`ShardedCooldownStore`** treats a manager that does not answer as a store failure, handled by `cooldownStoreFailure`, rather than counting in the shard.
- **`testCooldownStore`** checks the batch path too: a batch is counted at once and names the longest wait, and for a store that overrides `consumeMany`, a refused batch records nothing and concurrent batches at the limit let exactly one through.

See [Smaller changes](https://github.com/meocord/meocord/blob/main/docs/MIGRATING.md#smaller-changes) in the upgrade guide.
