---
'meocord': minor
---

A cooldown store's refusal can say when the next call is allowed: `CooldownVerdict.retryTimestamp`, a Unix timestamp in milliseconds on the store's own clock. Every refusal in one wait gives the same one. `MemoryCooldownStore`, `RedisCooldownStore` and `ShardedCooldownStore` give it, and `messages.dmOnCooldown` tells one wait from the next by it. A store of your own can add it to its refusals; without it, waits are told apart by `retryAfterMs` and the bot's clock, as before. `testCooldownStore` checks a store that gives it.
