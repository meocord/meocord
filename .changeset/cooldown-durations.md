---
'meocord': patch
---

`@Cooldown`'s `seconds` is now counted in whole milliseconds, and a window no store can count is refused where the decorator applies.

- A `seconds` value whose milliseconds weren't a whole number, such as `16.1`, made `RedisCooldownStore` fail every call to that handler with "ERR value is not an integer or out of range", while the memory store used in development and tests counted it fine. `seconds` is now rounded to the millisecond, once, so every store gets a whole `windowMs` of at least 1.
- `seconds` must be from `0.001` to `9007199254740`. `Infinity` and other values beyond that were accepted, and each store did something different with them: the memory store refused with "try again in Infinitym NaNs", Redis failed every call, and process sharding never limited anything.
- `@MeoCord({ cooldownStoreTimeoutMs })` must be at most `2147483647`, the longest delay a timer keeps. A longer one fired at once, so every call with a cooldown timed out.
