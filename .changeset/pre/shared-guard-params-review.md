---
'meocord': patch
---

A shared guard that calls another shared guard, such as one injected into it, no longer makes the inner guard read the outer guard's `params`. Each guard reads only the params its own `{ provide, params }` entry gives; called directly by another guard, it reads its own values.

A shared guard whose class takes a param through a setter, such as `set limit(value)`, gets it again: the value was dropped, and the guard read its own. Such a param has nowhere to be kept per call, so it is set on the shared instance, as it was before shared guards read each call's own params, and the bot warns once that overlapping calls can read each other's. Reading the param as a plain property, or not binding the guard, avoids that.

A shared guard whose instance is sealed (`Object.seal(this)`) cannot read each call's own params: its properties cannot be changed to do so. It takes them on the one instance, as before, so overlapping calls can read each other's params and a call without params reads the last ones given; the bot now warns about such a guard once. Leave the instance unsealed, or stop binding the guard, to keep calls apart.
