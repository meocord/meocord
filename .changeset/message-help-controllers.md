---
'meocord': patch
---

In a testing module, `HandlerRegistry.messageHelp()` lists only the controllers' message commands from the start, as a bot does. Before, a `@MessageHandler` declared on a service, which never runs, was listed until the module had dispatched something. A test that called `messageHelp()` before any dispatch and expected such a command in the list sees it left out.
