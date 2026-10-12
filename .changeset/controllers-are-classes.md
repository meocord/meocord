---
'meocord': patch
---

`@MeoCord({ controllers })` is typed as a list of classes, as it is read at runtime. A string or symbol there compiled and then stopped the bot at startup ("takes classes, not …"); it's now a type error. `services` still takes provided tokens.
