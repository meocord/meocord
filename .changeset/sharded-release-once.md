---
'meocord': patch
---

A `ShardedCooldownStore` verdict's `release()` undoes its call once, however often it's called, as the memory and Redis stores do. A second call sent the shard manager a second undo, which took another call recorded on the same key in the same millisecond, so the cooldown let a call through over its limit.
