---
'meocord': patch
---

`module.dispatch()` no longer throws `TypeError: message.content?.trim is not a function` for a mock message made without `content` and without `useStrictMocks()`. Such a mock's `content` is a placeholder, not a string, and dispatch now treats it as a message with no text: it runs no handler and resolves `{ ran: false, handlers: [] }`, as it does under strict mocks and as a bot does for a message with no text. Nothing changes for a bot, whose messages always have string content.
