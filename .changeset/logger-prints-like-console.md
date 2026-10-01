---
'meocord': patch
---

`Logger` prints objects as `console.log` does, and redacts the bot's credentials from everything it prints: non-enumerable properties no longer appear, and objects print four levels deep.

- Nested data a bot logs, such as a payload or its settings, still shows in full, and a discord.js structure prints a few hundred lines instead of everything it reaches.
- An error prints as before: its stack, its own properties such as `code`, its `cause`, and an `AggregateError`'s errors. Its message and stack are no longer printed a second time below it.
- Nothing to change in your code.
