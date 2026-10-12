---
'meocord': patch
---

The built-in cooldown stores' `consume()` refusals carry `retryTimestamp`, when the wait ends, as their `consumeMany()` refusals do. A store of your own that asks a built-in store's `consume()` for each key, and keeps the default `consumeMany()`, now passes it on, so `messages.dmOnCooldown` tells one wait from the next by it, and a late answer no longer DMs the author twice in one wait. On `consume()`'s refusal the field is non-enumerable, so it still compares with `toEqual` and serialises as `{ allowed, retryAfterMs }`.
