---
'meocord': minor
---

`createMockRawMember()` builds the member Discord sends with an interaction from a server the bot isn't in: plain data with `roles` as role ids and `permissions` as a bitfield string, as discord.js keeps it. To test a user-installed command run there, give it as an interaction's `member` with the server's `guildId` and no `guild`:

- the interaction reads `inRawGuild()` true, `guild` and `channel` `null` (with its `channelId` kept), `user` the member's user and `memberPermissions` the member's;
- a user option's member is the resolved member Discord sends;
- the interaction is typed as a `'raw'` one;
- a guard that reads `member.roles.cache` throws, as it would in Discord.

A raw member with a `channel`, without a `guildId`, or with a different `user` is refused. Given with a `guild`, it reads as a cached server's member, as before, with a warning once to leave the guild out. A `guildId` given alone builds the interaction as before. See https://meocord.dev/docs/4.2/mocks.
