---
'meocord': patch
---

The process-sharding manager checks what it can before it does anything:

- **A build for another platform stops before the manager registers commands or spawns a shard.** The check ran only in each shard, so the manager registered the commands and spawned shard 0 before the build was refused.
- **A missing bundle is found before anything is registered.** A manager started without a bundle to spawn shards from registered the commands and asked Discord for the shard count before saying it could not find one.
- **`start()` starts the manager once.** A second call, at once or later, registered the commands and spawned every shard again; it now waits for the first.
