---
'meocord': patch
---

Under `useStrictMocks()`, `inspectHandler()` lists the guards, interceptors and observers dispatch runs for the handler's context types, as its JSDoc says. A global `@Guard({ types: ['message'] })` isn't listed for a slash command, an `@Autocomplete` handler lists no interceptors, and an observer with `types` is listed only for handlers it is told about. In default mode it still lists every one, with a warning once where dispatch runs fewer.
