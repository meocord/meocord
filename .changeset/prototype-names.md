---
'meocord': patch
---

A command, an option or a modal field named like a member of `Object.prototype`, such as `constructor`, `__proto__` or `toString`, now routes like any other name. Declaring `@Command('constructor', …)` used to throw `metas.findIndex is not a function`, and an undeclared command of such a name, say one left registered, failed with an error log instead of "Command not found!". An option or a modal field named `__proto__` now reaches the handler as an own param, and a customId param named `constructor` is no longer reported as colliding with a field that doesn't exist. Nothing to change in your code.
