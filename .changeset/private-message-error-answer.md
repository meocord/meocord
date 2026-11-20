---
'meocord': patch
---

An error on a component on a private message, or on a modal submitted from one, is added to that message only when MeoCord answered the interaction on that message, with an update or a deferred update. Otherwise it is sent as a private follow-up. Before, an error after the app's own `interaction.reply()`, after a follow-up that took the place of a deleted answer, or after Discord reported the interaction already answered, replaced that other response with the message's components and the error. The same applies to putting a select menu back: a pick is put back with an edit only after MeoCord deferred it, never after the handler's own `interaction.deferReply()`.

A handler that answers with discord.js directly, through `interaction.update()` or `interaction.deferUpdate()`, and then fails, now gets the error as a private follow-up instead of added to the message. A test that checks the calls for such a handler now sees `followUp` where it saw `editReply`.
