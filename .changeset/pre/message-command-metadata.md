---
'meocord': minor
---

`@MessageHandler` takes `aliases`, `description` and `scope`. `aliases: ['m']` lets `!m @ana` run `mute {target:member}`, each alias standing in place of the words the pattern begins with. `scope: 'guild'` or `'dm'` answers a message sent elsewhere that the command works in a server only, or in direct messages only, and the handler does not run; `MessageUsageError` gains `dmOnly` for the second. `HandlerRegistry`'s message entries list each command once, with its `command` words, `aliases`, `description`, `scope`, `usage(prefix)`, the text a usage error shows, and `matches(words)`, for a help command of the app's own; the README has one to start from.
