---
'meocord': patch
---

A `@MessageHandler` whose own `prefix` is `''`, no prefix, no longer stops every message command in the bot: each message threw `Cannot read properties of undefined (reading 'toLowerCase')` before any handler ran. The handler now matches messages without a prefix, as its JSDoc says, beside the handlers that use the app's prefix or their own.
