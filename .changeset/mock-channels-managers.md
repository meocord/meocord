---
'meocord': minor
---

`meocord/testing`'s mock channels, and the managers that fetch, answer as discord.js does, and `createMockMessage` takes the `channel` it was sent in.

- An interaction's `channel` is a text channel of its server, the one the server caches under `channelId`, or the user's DM channel in a DM. It was a stub, whose `send()` and `isTextBased()` threw. A `channel` given still wins.
- A message's `channel` is a text channel of its server, cached there, or the author's DM channel for a DM. It was a bare text channel with no managers. Pass `createMockMessage({ channel })` to send it in another.
- A mock channel's type guards, such as `isTextBased()`, `isDMBased()`, `isThread()` and `isSendable()`, run discord.js's own logic. They returned `undefined`, so `if (!channel.isTextBased()) return` returned early. A voice channel carries its text chat, and a forum its tags, as discord.js tells them apart by.
- A manager's `fetch(id)` resolves to its cached item with that id, such as a member given to `createMockGuild({ members })`, or to a new one with that id, which it caches. It returned an item with another id. A member fetched from a guild's `members` is in that guild.

A test that relied on one of the old answers changes with it; nothing changes in a bot.
