---
'meocord': patch
---

`meocord generate controller` writes a spec that tests the handler. It invokes the handler with a mock of the interaction, message or reaction it handles, and checks what it answers. Before, every spec only checked that the controller existed, and passed whatever the handler did. A generated slash, context menu or entry point builder now takes the command's name from `@Command` (`build(commandName)`), so the two can't drift apart. Files you've already generated are unchanged.
