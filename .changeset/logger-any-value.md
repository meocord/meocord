---
'meocord': patch
---

`Logger` prints a value of any type, and no value makes it throw. A `Symbol` threw `Cannot convert a Symbol value to a string`, so a handler or an observer that threw a `Symbol` made MeoCord's own log of it throw too, and from an observer that became an unhandled rejection. Anything other than a string now prints as `console.log` prints it: `Symbol(boom)`, `10n`, `[Function: handler]`. A number or a boolean takes `console.log`'s colour rather than the level's. Nothing to change in your code.
