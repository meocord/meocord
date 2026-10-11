---
'meocord': patch
---

The `GuardOptions.types` documentation now says that an autocomplete is its own context type, `'autocomplete'`. A guard declared with `types: ['interaction']` doesn't run before `@Autocomplete` handlers, as before. To run it there too, declare `types: ['interaction', 'autocomplete']`. Before an autocomplete, return `false` to show no choices. Nothing changes at runtime.
