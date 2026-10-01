---
'meocord': minor
---

A catalog message shows a brace as text when it is written twice, and a translator says when a key has no message.

- `{{` and `}}` are one brace each, when the code compiles and when translating, so `'Buttons use ticket/{{id}}'` shows `ticket/{id}` and takes no `id` param. A 4.1 beta catalog that writes `{{name}}` for a param inside braces now shows `{name}` as written; write `{{{name}}}` instead.
- `localizations(key)` takes only a message without `{params}`, as Discord shows a name or description as written. Another key fails to compile, or, in a catalog the compiler can't read, such as a JSON file, throws as the app loads. A translation with a `{param}` is left out, so Discord shows the default for that locale, and `expectCompleteCatalog` reports it.
- In development, a key with no message, or one naming a group of messages, logs a warning once, since the key is shown in its place.

See [Localisation](https://meocord.dev/docs/4.1/localisation).
