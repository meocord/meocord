---
'meocord': minor
---

Under `useStrictMocks()`, a mock interaction's answers resolve to what discord.js's do, so a handler that uses the response works in its test:

- `reply()`, `deferReply()`, `update()` and `deferUpdate()` resolve to a mock `InteractionResponse` bound to the interaction. Its `edit()`, `delete()` and `fetch()` reach the interaction's `editReply()`, `deleteReply()` and `fetchReply()`, and `createMessageComponentCollector()` and `awaitMessageComponent()` are mock functions, as on a mock message. A test there that asserts `resolves.toBeUndefined()` on one of them now fails: assert on the response instead, or drop the assertion.
- With `withResponse: true`, each resolves to an `InteractionCallbackResponse` holding what Discord answers. `reply()`'s and `deferReply()`'s `resource` is of type `ChannelMessageWithSource` and holds the message as `fetchReply()` reads it at that moment, for `deferReply()` the loading message, whose id the reply keeps. `update()`'s is of type `UpdateMessage` and holds the updated message. `deferUpdate()` has no `resource`: it is `null`. The callback's `interaction` names the message, the component's for an update, with `responseMessageLoading` `true` only for `deferReply()`.
- A deferred reply reads as Discord shows it until it is edited: `fetchReply()` after `deferReply()` gives a message flagged `Loading`, and `Ephemeral` too for a private deferral, where it had neither flag. An edit clears `Loading`.
- `respond(interaction).send()` resolves to the message the reply or the update sent, where it resolved to `undefined`.
- With `withResponse`, and so through `respond()`, the message takes its generated id when the answer resolves, where it took one when first read, so the generated ids of mocks made after it can differ by one.

Without strict mocks, all of these resolve as before. The first time an app's or a test's own code calls one of the four methods, one warning is logged for the run; MeoCord's own calls, such as `@Defer`'s acknowledgement and `respond()`'s answers, don't log it. A test that asserts `Logger.warn` was never called fails on that warning the first time its own code calls one of them: assert on the warnings it expects instead, or call `useStrictMocks()`. The next major version (5.0) resolves them as strict mocks do, without the call ([#441](https://github.com/meocord/meocord/issues/441)). See [Mocks](https://meocord.dev/docs/4.3/mocks).
