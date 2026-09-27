---
'meocord': minor
---

A button's, select menu's or modal's customId pattern can type a param, `{name:type}`, with `int`, `number`, `bool` or words to choose from such as `{order:asc|desc}`, read by the parsers message commands use. The handler receives the value, such as a number for `@Command('counter/{count:int}', CommandType.BUTTON)`, and its params are checked against the pattern when the code compiles; `route(pattern).build()` takes values of those types. A segment that is not a value of its type matches no route. Such a pattern used to be read as literal text, so it silently never matched; a type a customId cannot hold, such as `{target:member}`, now stops the bot where it is declared. `resolveRoute`'s `params` can hold numbers and booleans, from typed params.
