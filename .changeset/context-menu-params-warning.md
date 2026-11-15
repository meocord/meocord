---
'meocord': minor
---

Two changes the next major version (5.0) makes at compile time are now announced:

- A context menu handler that declares a second parameter is named in a startup warning, and by a testing module as it compiles. A context menu command has no options, so that argument is always `{}`; remove it. In 5.0 such a handler fails to compile. The check reads the method's parameter count, so a second parameter with a default value, or a rest parameter, goes unnamed. See [Context menus](https://meocord.dev/docs/4.3/context-menus).
- `@Autocomplete<T>(…)`'s type argument is deprecated, and your editor strikes it through. It did nothing: the handler's return type is inferred. Write `@Autocomplete(…)`; in 5.0 the type argument fails to compile. See [Autocomplete](https://meocord.dev/docs/4.3/autocomplete).
