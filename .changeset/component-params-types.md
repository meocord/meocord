---
'meocord': patch
---

A component handler's params are checked against what a call gets, when the code compiles:

- **A select menu's choices** have their real types: `values: string[]`, `users: User[]`, `members`, `roles` and `channels` as discord.js resolves them. A declaration no choice can have, such as `values: number` or `users: string`, fails to compile, where it used to compile and then fail on the first selection. A narrower type that a choice can hold, such as `members: GuildMember[]` or `readonly Role[]`, still compiles.
- **A plain-string customId pattern's keys** are checked as a `route()`'s are. With `@Command('stats/{id}', CommandType.BUTTON)`, a handler declaring `{ uid }` fails to compile, naming `uid`, since that param was always `undefined`. Fix the name to one the pattern captures.
