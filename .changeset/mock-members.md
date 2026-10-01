---
'meocord': minor
---

`meocord/testing` adds `createMockMember({ user, guild, roles, nickname })`, and its mock users and members answer as discord.js does.

- `createMockMember()` makes a member with the roles given. `roles.cache` holds the server's @everyone role, then those roles; `roles.add()`, `remove()` and `set()` change them and resolve to the member; `roles.highest` is the role that ranks highest, by position, then the lower id. `permissions` are its roles' permissions combined, @everyone's included, or every permission for the server's owner. Pass the member to `createMockGuild({ members })`, and an interaction or a message from its user in that server has it as its `member`. See [Mocks](https://meocord.dev/docs/4.1/mocks).
- Every mock member has a `roles` manager and `permissions`, with only @everyone unless given roles (for an interaction with a `guildId` but no `guild`, an @everyone with that id), instead of stubs that threw on `roles.cache.has()` or `permissions.has()`. A mock role has an id, `position` 0 and no permissions unless given.
- A mock guild has an @everyone role, `roles.everyone`, in `roles.cache`: the role given to `createMockGuild({ roles })` with the guild's id, or one at position 0 with no permissions. A guild's `roles.cache` therefore holds one more role than the roles given, unless one of them has the guild's id.
- An interaction in a server has the member's permissions as `memberPermissions`, and `null` in a DM, instead of a stub whose `has()` threw.
- Every mock user is a person, `bot: false`, however it is made. `createMockInteraction(User)` gave a truthy `bot`, so a message from that user reached no handler.
- A DM sent to a member goes through its user's `send()`, and a user's through its one DM channel, so `user.send`, `member.send` and `(await user.createDM()).send` each see it. `createDM()` resolves to that channel; it returned `undefined`.
- In `createChatInputOptions`, a user option's `getMember()` is the user's member in the interaction's server, and `null` in a DM, instead of the user; a member given resolves `getUser()` to its user. A whole number is an Integer option and a fraction a Number one, so `getInteger()` returns `null` for `1.5`.

A test that relied on one of the old answers changes with it; nothing changes in a bot.
