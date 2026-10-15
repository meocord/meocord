---
'meocord': patch
---

A mock manager's `create()` and `edit()` in `meocord/testing` now make and reach the item they're asked for:

- **`guild.channels.create()`**, under `useStrictMocks()`, makes a channel of the type its options name, such as a `VoiceChannel` for `ChannelType.GuildVoice`. In default mode it still makes a text channel, with a warning once for another type.
- **A manager's `edit(id, options)`**, under `useStrictMocks()`, resolves to the item with that id, the one its cache holds, or one made and cached under that id. In default mode it still resolves to a new item with another id, with a warning once.
- **A `name` given to `create()` or `edit()`** names the item under `useStrictMocks()`, as discord.js does. Default mode keeps the name the mock gives, with a warning once.
- **A thread a channel's thread manager creates or fetches** has that channel as its `parent`, and is in its server, in both modes. Under `useStrictMocks()` the parent is also cached in the server's channels, as discord.js finds it there; default mode leaves that cache as it was.
