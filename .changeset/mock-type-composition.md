---
'meocord': patch
---

Mocks from `meocord/testing` now pass to one another, and to the testing module, without a cast:

- **A mock reached through a property that may be `null`** keeps its mock API, such as `message.member?.fetch.mockResolvedValue(member)` or `message.guild?.members.fetch`.
- **An overloaded method's mock** takes what any of its overloads takes or resolves to, such as `guild.members.fetch.mockResolvedValue(member)` and `channel.messages.fetch.mockResolvedValue(message)`, where only the list form compiled before.
- **`createMockInteraction` given `guild: null`, `member: null` or a DM channel** builds an interaction outside a server, typed so its `guild` and `member` may be `null`.
- **`createMockMessage`** is typed as discord.js emits a message, so `module.emit('messageCreate', createMockMessage())` compiles.
- **`createMockChannel(ThreadChannel)`** is typed as a public or private thread, as discord.js types every thread, so it fits an interaction's `channel`, a guild's channels and the `threadCreate` event.
- **`getResponse(interaction).calls[n].payload`** is typed by the call's `method`: after `call.method === 'reply'`, it is the reply's options. A cast of a payload to a shape its method can't send, which compiled while the payload was `unknown`, now fails; read it as the method's options instead.
