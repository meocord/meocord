---
'meocord': patch
---

`meocord/testing`: mocks read the data Discord always sends as Discord sends it. A mock guild's `preferredLocale` was an empty stub object, so `t.forGuild(createMockGuild())`, and a message command's usage reply on a mock message, came out in the translator's default language whatever the test meant. It is now `'en-US'`, and a guild's `name`, a user's `username`, a message's `pinned`, a channel's `type` and the rest have Discord's values: `false` for a flag, `null` for what may be absent, and snowflake ids. `tag`, `displayName`, `createdAt` and `url` are computed from them as discord.js does. `createMockGuild` takes `name` and `preferredLocale`, so `createMockGuild({ preferredLocale: Locale.Indonesian })` gives a server that speaks Indonesian.

An interaction with a `guildId` has its user as its `member`, and its `guildLocale` is the `preferredLocale` of the `guild` it is given, as Discord sends it, where it was always `'en-US'`. A mock message has its author as its `member` in a server, and `null` in a direct message, and its `inGuild()` answers as discord.js's does, where it returned `undefined`. A test that reads a property a mock has no value for now gets that value instead of a stub object; one that relied on the stub there sets the property itself. `commandName`, `customId` and a message's `content` stay the test's to give.
