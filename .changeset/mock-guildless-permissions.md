---
'meocord': patch
---

Without `useStrictMocks()`, a mock channel made without a server no longer throws `this.guild.members.resolve is not a function` from `permissionsFor()`, and neither does `member.permissionsIn(channel)` or an interaction's channel given only a `guildId`. A channel with no server holds a placeholder for one, so its `permissionsFor()`, `overwritesFor()`, `memberPermissions()` and `rolePermissions()` return `undefined`, as a thread's do, with a one-time warning that says to give the channel a `guild` or call `useStrictMocks()`. A channel given a server, and every channel under strict mocks, computes its permissions as before.
