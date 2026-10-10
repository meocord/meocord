---
'meocord': patch
---

A controller listed twice in `@MeoCord({ controllers })` or `MeoCordTestingModule.create({ controllers })` is one controller: its `@MessageHandler()` listeners run once per message, and its reaction handlers once per reaction, where they ran twice. Commands and components were already routed once.
