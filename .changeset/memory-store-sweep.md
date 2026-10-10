---
'meocord': patch
---

A `MemoryCooldownStore` that nothing uses any more is garbage-collected once its calls have expired. Its sweep timer held it for as long as the process ran, so a test run kept one store per testing module that dispatched a cooldown. The sweep now stops when it leaves the store empty and starts again on its next call; counting is unchanged.
