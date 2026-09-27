---
'meocord': patch
---

A class-level `@UseGuard` now also guards the controller's `@Autocomplete` handlers, including inherited ones, as it does commands, components, message and reaction handlers. Global guards from `@MeoCord({ guards })` run there too. A guard sees an `AutocompleteInteraction` and `ExecutionContext.getType() === 'autocomplete'`, and must not reply; when a guard denies, the menu is closed with an empty list instead of being left loading.

This changes which guards run for autocomplete. If a class guard assumes a command interaction or replies on denial, see [Class guards now cover autocomplete handlers](https://meocord.dev/docs/4.1/migrating#class-guards-now-cover-autocomplete-handlers).
