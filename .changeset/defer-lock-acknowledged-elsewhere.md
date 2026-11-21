---
'meocord': patch
---

When Discord refuses `@Defer`'s acknowledgement, or `respond(interaction).lock()`'s, because something else already answered the interaction (40060), the message is no longer locked. That other answer may be a reply, and the lock's two edits went to it: first the loading view with the message's controls disabled, then a copy of the message, so the reply's own content was lost. Now nothing edits it, and an error from the handler follows up privately as before.

A test that rejects `deferUpdate` with `createDiscordError(40060)` under `@Defer` now sees no `editReply` from the lock and its restore. Locking after the app's own `interaction.deferUpdate()` is unchanged.
