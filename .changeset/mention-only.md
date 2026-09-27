---
'meocord': minor
---

`@MeoCord({ messages: { mention: 'only' } })` starts every message command in a server with a mention of the bot and nothing else, neither a prefix nor the message as plain text, while a direct message starts as usual, after the prefix or as it is; `@MessageHandler(pattern, { mention: 'only' })` does the same for one command beside the app's prefix. Discord sends a message's text without the privileged MessageContent intent when the message mentions the bot, and in direct messages, so such commands, and commands with `scope: 'dm'`, no longer need it: MeoCord's startup warning about MessageContent names only a `@MessageHandler()` listener and commands a prefix or plain text starts in a server, and says what still arrives without it. A mention-only bot can run without the intent, and without applying for it once verified.
