---
'meocord': patch
---

A mock of a discord.js method that returns a promise without being declared `async` now resolves, as the Mocks guide says, where it returned `undefined` and `.catch()` or `.then()` threw. This covers `member.kick()`, `awaitMessages()`, `awaitMessageComponent()` and `awaitReactions()` on messages and channels, `createWebhook()` on guild channels, `guild.members.unban()` and `bulkBan()`, `deleteDM()`, `fetchAuthor()`, `fetchUser()`, `fetchSubscribers()`, `fetchVoters()`, `createStageInstance()`, `voiceState.disconnect()`, `delete()` on an application command or AutoMod rule, a role manager's `set()`, a scheduled event's `setStatus()` and a permission overwrite manager's `create()`. `kick()` resolves to the member, and `awaitMessages()` and `awaitReactions()` to an empty collection, as nothing answers a mock.
