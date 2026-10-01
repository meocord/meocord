---
'meocord': patch
---

`meocord/testing`'s mocks take where they were made, and what a user option carries, as discord.js reads them:

- **A channel given to `createMockInteraction` or `createMockMessage`** sets the `channelId`, `guildId` and `guild` the test leaves out. A DM channel is no server, so `inGuild()` is `false`, and a server's channel puts the mock in its server. An interaction given a channel kept a `channelId` of its own, so a per-channel cooldown counted each one apart, and a message given a DM channel said it was in a server. A server's channel that names no server is put in the mock's. The channel is cached on the mock's client, as the gateway caches it.
- **A mock channel's managers** have it as their `channel`, and a thread's `members` as their `thread`, as discord.js's do.
- **A user option from `createChatInputOptions`** carries its `user`, and in a server its `member`, as the gateway sends them. A member given carried only `member`, as in 4.0, so a handler's param typed `User` got the `GuildMember`.
- **A select menu given its `users`, `members`, `roles` or `channels`** has their ids as `values`, as Discord sends them. They stayed empty unless given as well.
