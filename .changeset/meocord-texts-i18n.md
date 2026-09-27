---
'meocord': minor
---

MeoCord's own texts for users go through the app's translator: a message command's usage and each thing wrong with it, the built-in `!help` and the labels of `HandlerRegistry.messageHelp`, cooldown and cooldown store refusals, "Command not found!", the generic error, and the default presenter's "Working on it…" and "Oops!". Add a `meocord` group to any catalog given to `@MeoCord({ i18n })`, all of it or part, such as `meocord: { usage: { heading: 'Cara pakai: {usage}' } }`; a text a locale leaves out stays in English, line by line. Answers to an interaction are in the user's language, replies to a message in the server's preferred language, or the default locale's in a DM. The keys and their English are in the new `MeoCordMessages` type from `meocord/interface`, and a key MeoCord lacks, or a `{param}` its English text lacks, fails to compile. Without `i18n`, every text is the English one it is today.

- `translateError(error, t, target)` from `meocord/common` returns the text the fallback answers an error with, in the language of an interaction, a message or a locale, for an exception filter that answers MeoCord's errors its own way.
- A message param type takes `labelKey`, a message key of the app's catalog, for a label in each server's language. `@MeoCord` refuses one without `i18n`, or one the default catalog has no message for.
- `expectCompleteCatalog(t, { meocord: true })` requires every locale that is not English to translate each of MeoCord's texts. Without the option it reports only a `meocord` key MeoCord lacks.

See [Localisation](https://meocord.dev/docs/4.1/localisation).
