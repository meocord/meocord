---
'meocord': minor
---

`@MeoCord({ messages: { handlers: 'concurrent' } })` runs a message's matched command and its `@MessageHandler()` listeners together, so a slow or hung command no longer holds back logging, moderation and the other listeners. Each keeps its own guards, interceptors, filters and observers, and the call settles once all have; no order holds between them, so a listener that reads what the command writes for the same message should keep the default, `'sequential'`. ([docs](https://meocord.dev/docs/4.2/message-commands))

Under `'sequential'`, a running bot now warns, once per handler, when a message's handler takes 5 seconds or more with listeners waiting after it, naming the option. `messages: { slowHandlerWarning: false }` turns the warning off. A `MeoCordTestingModule` doesn't warn unless `slowHandlerWarning` is `true`, so a test whose fake clock passes 5 seconds inside a handler sees nothing new.
