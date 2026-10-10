---
'meocord': patch
---

Messages a mock sends or fetches are where they belong and hold what was sent:

- A message from a channel's `send()`, a message's `reply()` or `forward()`, or an interaction's `followUp()`, `editReply()` or `fetchReply()` holds the content, embeds and components of the call that made it. It is in the channel it was sent in and that channel's server. Before, it sat in a generated channel of a generated server, with a stub `content`.
- A message's `edit()` changes that message and resolves to it, where it resolved to a new one. `crosspost()` resolves to the message itself.
- A message fetched with `messages.fetch()` is in the channel it was fetched from, with an author other than the bot.
- A role made with `roles.create()` or fetched with `roles.fetch()` is in its server. A role, channel, thread or application command a manager's `create()` makes is in that manager's cache, as discord.js caches it. `bans.create()` resolves to the member, user or id it was given and caches nothing, as discord.js's does.

Under `useStrictMocks()`, a message the bot sends is its `client.user`'s, so its `editable` reads `true`. One sent in a DM is in that DM: `inGuild()` is `false`, and `guild` and `member` are `null`. In default mode these keep today's values and warn once when read: the author of a message the bot sent, and the server of one sent in a DM. The next major version (5.0) reads them as strict mocks do.
