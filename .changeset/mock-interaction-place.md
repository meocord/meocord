---
'meocord': patch
---

Two fixes to where a mock interaction from `meocord/testing` is, in both modes unless noted:

- **A user context menu given a `targetUser`**, under `useStrictMocks()`, caches that user on the client, as discord.js resolves it, so `targetMember` is that user's member. In default mode `targetMember.user` is still another user with the same id, and the first read of `targetMember` warns once.
- **A mock given only a `guildId`, in default mode,** now reads `guild` as a placeholder server with that `id`, whose managers' caches are empty collections, so `guild.id` is the `guildId` and `guild.members.cache.get()` returns `undefined`. Before, `guild.id` was a placeholder object and `guild.members.cache.get` was not a function. It is still no `Guild`, so `inCachedGuild()`, `inRawGuild()` and the permission reads answer as before, and its warning now says it reads a placeholder server with that id. Under `useStrictMocks()` `guild` stays `null`, as discord.js has it for a server the bot isn't in.
