---
'meocord': patch
---

Mocks from `meocord/testing` now compute what discord.js computes from them, where they returned `undefined` or a placeholder object:

- **Lookups:** a manager's `resolve()` and `resolveId()` read its cache, so `guild.members.resolve(id)` finds a member given to `createMockGuild`. `guild.members.me` is the bot's member, the cached one or one with @everyone. A guild's roles and channels, and the guilds of a client's messages and interactions, belong where discord.js puts them, and everything in a guild shares its client.
- **Ranking and permissions:** `role.comparePositionTo()`, `channel.permissionsFor()`, `member.permissionsIn()` and an interaction's `appPermissions` compute from the roles, the channel's `permissionOverwrites` and the bot's member. Being real, they keep working after `resetAllMocks()`.
- **Messages:** `message.member` reads the guild's member cache, so a test that removes the author's member there gets `null`, as discord.js gives for an author it hasn't cached. A default message now caches its author and the author's member, as Discord's message event does. `message.mentions.has(user)` answers from what the content mentions.
- **Defaults:** a role is not hoisted, managed or mentionable, with no icon, tags or colours. A member's `joinedTimestamp` is when the mock was made, so `partial` is `false`. A message has no `reference`, `poll` or stickers. `avatarURL()` and `iconURL()` are `null` without an avatar or icon, `displayAvatarURL()` is Discord's default avatar, and a mock client `isReady()`.
- **User context menus:** `targetUser` is the user with `targetId`, the client's cached one or one made, and `targetMember` that user's member in a server. A `targetId` given later picks its user, and both stay assignable.
