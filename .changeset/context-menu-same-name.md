---
'meocord': patch
---

A user context menu command and a message context menu command with the same name, which Discord allows, each reach their own `@Command` handler. The first handler declared under the name took both, so a message command could run the user command's handler.
