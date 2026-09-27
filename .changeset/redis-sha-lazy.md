---
'meocord': patch
---

Importing `meocord/common` no longer computes the Redis script hash until a `RedisCooldownStore` uses it. Each script's SHA1 is worked out the first time a store given `evalsha` runs it, then kept, so an app that never uses Redis hashes nothing, and one without `evalsha` never needs the hash.
