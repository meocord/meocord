---
'meocord': patch
---

A guard shared as one instance now reads each call's own `params`. A guard bound once, by listing it in `@MeoCord({ services })` or `providers` or by injecting it into a service, is a single instance for every call. When two handlers gave it different params, such as `{ role: 'admin' }` and `{ role: 'mod' }`, and their calls overlapped, one call's guard could read the other's params and allow or deny the wrong call. Each call now sees its own, while the instance, its state and its private fields stay shared. Guards made for each call, the default, are unchanged.

No action is needed. The startup warning about a guard listed in `services` is gone, since such a guard is now safe.

A sealed guard that declares the properties its params set, and no `params` property, takes its params again instead of failing the call. A frozen guard given params fails the call with an error that names the guard and says why.
