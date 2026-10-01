---
'meocord': patch
---

A shard whose manager is gone no longer crashes on a call with a cooldown. When the manager died, each shard began its graceful shutdown, but `ShardedCooldownStore` still sent to the closed IPC channel. On Node, that send raised an unhandled `'error'` event, so the shard exited 1 at once and skipped its shutdown hooks. On Bun, the message was dropped, and the call waited out `cooldownStoreTimeoutMs`. Now the store checks the channel before sending and reports a failed delivery to the call, so the call fails with `CooldownStoreError` at once on both runtimes, and the shutdown carries on.
