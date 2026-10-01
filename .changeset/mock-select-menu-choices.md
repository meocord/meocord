---
'meocord': patch
---

A mock select menu from `createMockInteraction` has picked nothing unless the test gives its choices, as discord.js builds one: `values` is an empty array, and `users` and `members`, `roles` or `channels` are empty `Collection`s, the ones its kind picks. They were stubs, so a handler's `interaction.users.map(...)` or `interaction.values.length` threw or read a function on a default mock. Values and collections a test gives are kept.
