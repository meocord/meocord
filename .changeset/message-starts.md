---
'meocord': patch
---

Two message handlers that can take the same message stop the bot at startup, wherever their starts are known as it starts. One with its own `prefix: '!'` and one using the app's `'!'`, own prefixes that share one (`'!'` and `['!', '?']`), `prefix: false` beside an app with no prefix, or two a mention starts in a server were all taken as different starts, so the order of your `controllers` decided which ran. The refusal names both handlers and their patterns; give one another prefix or pattern. An app whose prefix is a function gives its prefixes only as each message arrives, so a handler using it is refused only beside another that uses it too. Beside one with its own prefix or `prefix: false`, which the function can also give, the handler with its own start runs, whatever the order of your `controllers`.

A prefix function that finds no prefix for a message, returning an empty list, `undefined` or `null`, now lets no prefix start a command for it; a mention still does when `mention` is on. It took the message as it is, so in a server with no prefix of its own, plain chat starting with a command's word ran that command. Return `''` to take a message as it is. The function's type takes `undefined` and `null` too, so a lookup such as `return prefixes.get(id)` needs no cast.
