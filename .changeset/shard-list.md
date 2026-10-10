---
'meocord': patch
---

Under process sharding, a call to every shard now reaches each one for any shard count: `ShardContext.broadcastEval`, and discord.js's `client.shard.broadcastEval()` and `client.shard.fetchClientValues()`. They were refused with "Shards are still being spawned." unless the bot ran exactly 4 shards. Nothing to change in your bot.
