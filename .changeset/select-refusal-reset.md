---
'meocord': patch
---

A select menu no longer keeps showing a pick that MeoCord answers with an error. Such a pick is one refused by a guard such as `OwnerGuard`, by a cooldown or by invalid input, one no route takes, or one whose handler throws. MeoCord now answers it with an update that sets no field, which puts the menu back as it was before the pick in that user's client, then sends the error as a private follow-up. Before, it sent only the private reply, and the menu went on showing the refused option until the message was drawn again. The message itself is not rewritten: it keeps every edit made to it and shows no "(edited)", and nobody else sees a change. Under `@Defer`, a pick acknowledged and not edited since is put back with an edit that sets no field; one on a private message gets the error added to that message, as before. A filter's `respond(interaction).error()` answers a pick the same way. Buttons and modals are unchanged.

A test that checks the Discord calls for a refused pick now sees `update` with `{}`, then `followUp`, where it saw `reply`. Under `@Defer` it sees `editReply` with `{}` between `deferUpdate` and `followUp`.

An app that worked around this with a guard of its own can drop the workaround. Such a guard sends the message's components back before refusing, as `respond(interaction).edit({ components: interaction.message.components })`. Use `OwnerGuard`, or throw `GuardDeniedError`, on its own instead. Sending the components back could also undo a change made to the message after the menu was drawn. See [Guards](https://meocord.dev/docs/4.3/guards).
