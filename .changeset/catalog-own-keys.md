---
'meocord': patch
---

Catalog checks read a catalog's own keys and shapes, and a refused builder says what is wrong with a name:

- `expectCompleteCatalog` reads a group with an `other` key, such as `reasons: { spam, offTopic, other }`, as a group, as the translator's types do. It no longer fails a correct catalog for "lacking" plural forms, and it reports a key such a group misses in a locale.
- `expectCompleteCatalog` reads only a catalog's own keys, so a missing key named `constructor` or `toString` is reported. It also reports a translation of another shape than the default's, a text for a plural or the reverse, as `n should be a plural, as the default is`.
- A key with a `.` in its name, such as `'ban.done'`, is never found, because a lookup reads it as a path. `createTranslator` now warns about each one, naming the locale and the key, and `MessageKey`, `StringMessageKey` and `LocalizationKey` leave it out, so using one fails to compile. Nest it as a group: `ban: { done: … }`.
- `LocaleCatalog<C>` takes a `meocord` group with your translations of MeoCord's own texts, as `createTranslator` does.
- A builder refused for a name gives Discord's rule for one: letters, numbers, `-` and `_`, lowercase where the script has case, without spaces, up to 32 characters, in every locale.

A catalog test that passed with a gap of these kinds can now fail and name it. See [Localisation](https://meocord.dev/docs/4.2/localisation).
