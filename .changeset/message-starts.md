---
'meocord': patch
---

Two message handlers that can take the same message stop the bot at startup, however their starts are written. One with its own `prefix: '!'` and one using the app's `'!'`, own prefixes that share one (`'!'` and `['!', '?']`), `prefix: false` beside an app with no prefix, or two a mention starts in a server were all taken as different starts, so the order of your `controllers` decided which ran. The refusal names both handlers and their patterns; give one another prefix or pattern. An app whose prefix is a function is compared with the other handlers only where it is known, as handlers that use it alike.

A prefix function that finds no prefix for a message, returning an empty list, `undefined` or `null`, now starts no command for it. It took the message as it is, so in a server with no prefix of its own, plain chat starting with a command's word ran that command. Return `''` to take a message as it is.
