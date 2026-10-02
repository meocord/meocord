---
'meocord': patch
---

`meocord generate controller` writes a spec that tests the handler. It invokes the handler with a mock of the interaction, message or reaction it handles, and checks what it answers: how it answers, such as a reply or an update of the message, and the text, such as "Hello from /ping!" or, for a mentionable select menu given a user and a role, "Selected 1 user(s) and 1 role(s)." Before, every spec only checked that the controller existed, and passed whatever the handler did. A generated slash, context menu or entry point builder now takes the command's name from `@Command` (`build(commandName)`), so the two can't drift apart. Files you've already generated are unchanged.

The sample specs `meocord create` writes check the same way. The slash, context menu, button and modal samples check the text they answer. The message and reaction samples send a message or a reaction through `module.dispatch()`, as the bot routes it, and check the reply, where before they only checked that the controller existed.
