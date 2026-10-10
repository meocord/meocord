---
'meocord': patch
---

`t.localizations()` keeps the default locale's wording where Discord would show another locale's. Discord shows en-US users the en-GB value, en-GB users the en-US one, and es-419 users the es-ES one when their own locale has none. So when your default is en-US, en-GB or es-419 and its partner has a translation, the result now includes the default's own message too. A bot with such a pair re-registers its commands once, and a test that pins `t.localizations()` for one sees the default's entry.

An empty translation, `''`, which translation tools export for an untranslated string, now counts as missing:

- `t.localizations()` leaves it out, so Discord shows the default there, and a bot with one starts where it stopped;
- a reply falls back to a related locale or the default, where it was empty;
- `expectCompleteCatalog` reports it as missing.

See [Localisation](https://meocord.dev/docs/4.2/localisation).
