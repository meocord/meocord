---
'meocord': patch
---

Mocks give the values discord.js always sets where they gave stubs without methods, and the warnings about placeholders name the right reader.

- **Calls that threw now work, in both modes.**
  - `String(interaction)` on a slash command writes `/settings email address:a@b.c`, as discord.js does. An interaction made without `options` has an empty resolver.
  - `message.mentions.has(user, { ignoreRepliedUser: true })` answers. `mentions.parsedUsers` and `mentions.crosspostedChannels` are Collections.
  - These are empty collections and bitfields: `message.reactions`, `message.messageSnapshots`, a reaction's `users`, a member's and a user's `flags`, an interaction's `entitlements`, and a server's `presences`. A reaction's `users.fetch()` resolves an empty Collection.
  - A manager's lookups that read discord.js's own cache, such as `guild.presences.resolve(id)` and a thread's `members.resolve(id)`, find what its `cache` holds, else `null`.
  - So in default mode too, these fields hold discord.js's types instead of stubs. A test that relied on a stub's shape there sees the real value.
- **Under `useStrictMocks()`, data reads as discord.js gives it.**
  - A reaction's `me` is `false`, `mentions.repliedUser` is `null`, and a modal's `message` is `null`.
  - A message's `editedAt` comes from `editedTimestamp`. A member's `presence` is the one its server caches, else `null`. A server's `verified` comes from its `features`. `systemChannel` and a channel's `parent` are the channels their ids name, else `null`.
  - A voice or stage channel's `full` is computed.
  - A reaction made without a message has a whole one of its own, so a dispatched reaction is neither warned about nor fetched.
- **In default mode, values are unchanged.** Reading one of those values, or a voice channel's `full`, logs a warning once. The warning says what to set, or to call `useStrictMocks()`.
  - When MeoCord's dispatcher reads a reaction's placeholder `partial`, the warning says so. It also says the reaction was fetched because of it, and to set `reaction.partial = false` and `reaction.message.partial = false`.
  - `mentions.has()` reads `repliedUser` without a warning, since that placeholder matches no user.
- **Under `useStrictMocks()`, a test that asserted `reaction.fetch` or `message.fetch` was called during dispatch changes.** A whole mock reaction is no longer fetched. The next major version (5.0) reads these values as strict mocks do.
