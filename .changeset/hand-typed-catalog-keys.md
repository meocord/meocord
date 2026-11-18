---
'meocord': patch
---

A translator whose catalog type is written by hand in either of two shapes now translates. Each refused every key, with "Argument of type '"greet"' is not assignable to parameter of type 'never'" or "Expected 2 arguments, but got 1.":

- `Record<string, string | { one: string; other: string }>`, a type for JSON files that hold plurals. Every key is taken, with optional params, `count` among them, since a key may be a text or a plural. `t.localizations` takes none of its keys, as it needs a single text.
- An interface that extends `CatalogShape` and names its messages. Its named keys are taken, and a message written as literal text has its params checked, as in a literal catalog.

A message typed `string` takes any params, which only `expectCompleteCatalog` checks. Translators that compiled before still do, and assign as they did. See [Localisation](https://meocord.dev/docs/4.3/localisation).
