---
'meocord': patch
---

`MeoCordTestingModule.fromApp()`, `resolveRoute()` and `findRouteConflicts()` now refuse an app that isn't a class by naming the value, and point to its likely cause. For an import that reads `undefined` through a circular import, the message is `undefined is not a @MeoCord app: … An app import that reads undefined is often a circular import.` For a module namespace, as `import * as App` gives, it says to pass the class the module exports. Before, each threw a `TypeError` with an empty message for `undefined`, and one that named nothing for a module namespace.
