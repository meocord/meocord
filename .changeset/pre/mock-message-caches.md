---
'meocord': patch
---

`createMockMessage` caches what its content mentions, as the gateway delivers a message's mentions with it: `<@id>` a user in `message.client.users.cache` and, in a guild, a member in `guild.members.cache`; `<@&id>` a role; `<#id>` a channel; each also in `message.mentions`. A typed `user` param in a test, through `invoke` or dispatch, no longer throws `message.client.users.cache.get is not a function`. `createMockClient` has real `users` and `channels` caches, and every mock client is the same bot, `createMockClient().user.id`, so a message starting with a mention of the bot reaches its handler through `invoke`. `createMockMessage` takes `client` and `users` to set the client it arrived on and more cached users.
