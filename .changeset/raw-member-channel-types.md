---
'meocord': patch
---

`createMockInteraction`'s types now refuse a `channel` beside a raw member (`createMockRawMember()`), as the mock already did when built. A raw member is from a server the bot isn't in, where discord.js caches no channel. That covers a server's channel, `channel: null`, a DM channel, and a channel beside `guild: null`. These calls compiled and then threw "leave the channel out" at runtime. `{ guildId, member: createMockRawMember() }` still gives a raw-server interaction.
