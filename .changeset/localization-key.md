---
'meocord': minor
---

`meocord/common` exports `LocalizationKey<C>`, the keys `Translator.localizations()` takes: a single string with no `{params}`. The method's parameter used that type without a name you could import, so a helper that forwards a key to `localizations()` could not type it. `StringMessageKey<C>`'s documentation no longer says it is the type command names and descriptions need, and `TranslatorOptions` and `CatalogDefinition` are listed with the other localisation types.
