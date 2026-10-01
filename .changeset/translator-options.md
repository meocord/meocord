---
'meocord': minor
---

`createTranslator` and `defineCatalog` read as `createTranslator(options: TranslatorOptions<Locales, Default>)` and `defineCatalog(catalog: CatalogDefinition<T>)` in your editor and on the API pages, instead of spelling out the compiler checks they make. `TranslatorOptions` and `CatalogDefinition` are exported from `meocord/common`, each documented with what it refuses. The checks are unchanged. Nothing to change in your code.
