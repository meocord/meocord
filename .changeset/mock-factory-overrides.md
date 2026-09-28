---
'meocord': minor
---

`meocord/testing`: `createMockUser(props?)` and `createMockChannel(Class, props?)` take values for the mock's properties, as `createMockInteraction` does, so `createMockUser({ bot: true })` makes a bot and `createMockChannel(TextChannel, { name: 'general' })` a named channel. Neither took any before, so a bot user took `Object.assign`. The managers of a mock channel, `messages`, `threads` and a thread's `members`, and a mock guild's `bans`, have a real, empty `cache`, as a guild's `members`, `roles` and `channels` do, where reading `cache.size` gave a stub object.
