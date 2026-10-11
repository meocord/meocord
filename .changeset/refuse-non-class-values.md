---
'meocord': patch
---

Wherever MeoCord takes a class and is given something else, it now refuses the value and names where it was given, instead of crashing with an empty `TypeError` or reporting "This is a bug in MeoCord". TypeScript already rejects these values, so the refusal matters for plain JavaScript, `any` and casts.

- **`@MeoCord`'s `presenter`, `cooldownStore`, `controllers` and `services`** refuse an object or a function that isn't a class where the app is declared, for example `App: @MeoCord({ presenter }) takes a class implementing ResponsePresenter, not an object.`
- **A service listed by a string or symbol token** that no provider provides is refused as the app is created, naming the token.
- **Stage entries** given to `@UseGuard`, `@UseInterceptor`, `@UseFilter`, `@UsePipe` and `@MeoCord({ guards, interceptors, filters })` refuse an arrow function, a method, an async function or a generator function: "a function is not a class". A `function` declaration still works as a class.
- **`@Catch`** warns about an arrow function, as it already does for any other value that isn't a class, and treats it as matching no error. Before this fix, every call whose error reached that filter rejected with a `TypeError` from `instanceof`. A bound error class still matches.
- **A testing module** refuses a controller or an observer that isn't a class, and reports the refusal together with the other startup errors. After `reportAllStartupErrors()`, `fromApp()` on an app whose `@MeoCord` was refused throws the reason, not "is not a @MeoCord app".

A bot that started before starts unchanged.
