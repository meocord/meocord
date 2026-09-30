---
'meocord': minor
---

A translation's `{params}` are checked against the default catalog's. Until now only its keys were, so a translation that misspelt a param, such as `'Diblokir {usr}.'` for `'Banned {user}.'`, compiled and showed the user `{usr}` as written.

- **When the code compiles**, `createTranslator` refuses a message that uses a `{param}` its default message doesn't take, and a plural's form may use `{count}` besides. The error names each one, such as `id: ban.done takes no {usr}; the default is "Banned {user}."`. A translation may use the default's params in any order, and leave some out. The compiler reads a message's params only from a catalog whose text it keeps: one made with `defineCatalog`, written with `as const`, or written inline.
- **When a test runs**, `expectCompleteCatalog` from `meocord/testing` reports the same mistakes from the catalogs' own strings, so a catalog from a plain variable or a JSON file is checked too. It also reports a `{param}` that a translation of MeoCord's own texts uses and MeoCord's English doesn't take.

A `{param}` is the same thing in every check and when translating: ASCII letters, digits or `_` between braces. Other text in braces, such as `Wrap text in { and }.`, is the message's own. So a default message with such braces no longer makes `t('wrap')` ask for params it doesn't use. A message may also hold hundreds of params: one with 47 or more failed to compile with "Type instantiation is excessively deep and possibly infinite".

If your build or a test now fails, rename the param to the one the default message uses. A translation may leave a param out, but it can't add one: the translator only fills the params the default message names.
