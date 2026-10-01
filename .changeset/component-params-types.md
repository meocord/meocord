---
'meocord': patch
---

A component handler's params are checked against what a call gets, when the code compiles:

- **A select menu's choices** have their real types: `values: string[]`, `users: User[]`, `members`, `roles` and `channels` as discord.js resolves them. A declaration no choice can have, such as `values: number` or `users: string`, fails to compile, where it used to compile and then fail on the first selection. A narrower type that a choice can hold, such as `members: GuildMember[]` or `readonly Role[]`, still compiles.
- **A plain-string customId pattern's keys** are checked as a `route()`'s are. With `@Command('stats/{id}', CommandType.BUTTON)`, a handler declaring `{ uid }` fails to compile, naming `uid`, since that param was always `undefined`. Fix the name to one the pattern captures.
- **A key a pipe produces** is declared `Piped<T>`, as with `@Validate`, and the check leaves it to the pipe. That covers a choice `@UsePipe` turns into something else, a typed customId param such as `{id:int}` piped into an object, and a `@MessageHandler` pattern's param piped the same way, which no declaration could satisfy before. The check reads only the handler's own type, so it cannot see the pipe. A 4.1 beta handler that writes `@UsePipe('values', ToQuantities)` with `{ values: number[] }` now fails to compile, with a message ending "a key a pipe produces is marked Piped<T>"; write `{ values: Piped<number[]> }` instead.
