---
'meocord': patch
---

What a mock computes for itself no longer calls a method a test may stub, or caches anything a test can see.

- A mock message's `member` reads its server's member cache, as discord.js does, without calling `guild.members.resolve()`. A test's `members.resolve.mockReturnValueOnce()` is left for its own code.
- A mock interaction's `appPermissions` computes the bot's permissions with discord.js's own computation, without calling `channel.permissionsFor()`. Reading it no longer caches the bot's member in `guild.members.cache`. In a thread, it is the bot's permissions in the thread's parent, as Discord gives them, where it was empty.
- A mock interaction's `channel` is the channel its server caches under `channelId` each time it is read, so a channel a test caches there after a first read is the one read.
