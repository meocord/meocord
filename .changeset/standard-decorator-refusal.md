---
'meocord': patch
---

A MeoCord decorator run as a standard (TC39) decorator now throws at once, naming the decorator, what it was applied to and what to change: set `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` in tsconfig.json. A runtime that strips types without checking them, such as Bun, applies decorators that way when the tsconfig.json it reads doesn't set `experimentalDecorators`. Such a decorator used to warn that it was on a method named `[object Object]` and apply nothing, so the bot failed later, far from the cause; on a method, it threw a TypeError from inside MeoCord. A new app from `meocord create` sets both options already.
