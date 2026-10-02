---
'meocord': patch
---

`meocord/testing` mocks and `resolveRoute` behave as the bot does in four more places:

- **A mock interaction has a client.** `createMockInteraction` gives an interaction made without a `client` one from `createMockClient`, as a mock message has, with the interaction's user in `client.users.cache` and its channel in `client.channels.cache` once read. Code that reaches `interaction.client`, such as `interaction.client.users.cache` or `interaction.client.user.id`, reads real caches and the mock bot's id rather than stubs.
- **`getAttachment()` returns an attachment option.** `createChatInputOptions({ file })` with an `Attachment` makes `options.getAttachment('file')` return it, and `null` for an option not given.
- **Resolved media never takes the bot's id.** A thumbnail, image or media gallery item an edit resolves gets an id no other mock has, the mock bot's included.
- **`resolveRoute(app, { content, dm: true })` returns nothing for a handler that works only in a server,** by its `scope` or a `member`, `role` or `channel` param, as dispatch answers such a message with its usage and never runs the handler.
