---
'meocord': patch
---

`@MessageHandler('   ')`, a pattern of spaces alone, runs as `@MessageHandler()` does, for every message, and warns, naming the handler, as `@MessageHandler('')` does. It registered a command whose word is empty, which only a message starting with `""` reached, and nothing said so. Use `@MessageHandler()`; the next major version (5.0) refuses a blank pattern.
