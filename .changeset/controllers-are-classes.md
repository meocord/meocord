---
'meocord': patch
---

`@MeoCord({ controllers })` is typed as a list of classes, abstract ones included, as it is read at runtime. A string or symbol there compiled and then stopped the bot as `@MeoCord` decorated it ("takes classes, not …"), whatever the providers bound; it's now a type error. `services` still takes provided tokens.
