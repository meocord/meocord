---
'meocord': patch
---

`HandlerRegistry.messageHelp()` reads the message commands from the table dispatch routes with, so a help command of the app's own lists exactly what the built-in help lists. It also read `@MessageHandler`s on services, which no message reaches, and listed or described them as commands.
