---
'meocord': patch
---

`respond(interaction).lock()` after the handler's own `interaction.deferReply()` no longer edits that deferred reply. The lock and the next `send()` used to turn the reply into a copy of the component's message, loading view and controls included, while the message itself stayed unlocked. Now the lock draws nothing once a reply or a deferred reply is the answer. After the handler's own `interaction.deferUpdate()` it locks the message as before.

For tests: a default-mode mock interaction's `ephemeral` now reads `null` after the mock's `update()` or `deferUpdate()`, or after a test marks the interaction `deferred` itself, as discord.js does, where it read `false`, with a placeholder warning after the mock's own answers. A test asserting `toBe(false)` there now fails; `toBeFalsy()` still passes. This is an exception to default mocks staying as they were: `lock()` reads `ephemeral` to tell an update from a reply, so the mock has to read as discord.js does for a test to see the lock it would see in production. Before any answer, after `reply()` or `deferReply()`, and with `useStrictMocks()`, nothing changes.
