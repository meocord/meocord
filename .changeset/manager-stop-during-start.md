---
'meocord': patch
---

With process sharding, `stop()` called while `start()` is still registering the commands or asking Discord for the shard count now ends the start there: the manager registers nothing more, asks for no shard count, spawns no shard, installs no signal handlers and doesn't exit the process, and `start()` resolves. Before, the start carried on after the stop, and a failed shard-count request then exited the process. The `start()` JSDoc now says that a sharding manager's start resolves when `stop()` ends it, where a bot in one process rejects.
