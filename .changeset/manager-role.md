---
'meocord': patch
---

Under `meocord start --dev` with process sharding (`sharding: { mode: 'process', development: true }`), a shard that can't log in is reported as a failed login again: watch mode says the bot could not log in and starts it again on the next change in `src` or `.env`, where it reported a plain exit with code 1. Each app now decides once, as it is created, whether its process is a shard, before discord.js's `ShardingManager` writes the variable that marks one into the manager's own process. Nothing to change in your bot.
