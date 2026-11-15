---
'meocord': minor
---

`meocord/common` exports `formatDuration(ms, target?, options?)`, which writes a length of time for people: `formatDuration(3_900_000)` is `1h 5m`, and `{ style: 'long' }` gives `1 hour, 5 minutes`. Given an interaction or a message, it writes in that user's or server's language through your app's translator; given a `Locale`, through `options.t`. `units`, `largest`, `smallest` and `round` choose what it shows, and `{ style: 'param' }` writes `1h30m`, which a `{x:duration}` param reads back, for a value up to `Number.MAX_SAFE_INTEGER` milliseconds. See [Formatting](https://meocord.dev/docs/4.3/formatting).

Its unit words are new MeoCord texts in a `meocord.duration` group, the first of MeoCord's texts with plural forms, which an app's catalog translates like the others, with every plural form its language needs. `defineCatalog` refuses at compile time a translation of one of them without its `other` form, with a form that isn't a text, or with a key that is no plural category. `expectCompleteCatalog` now reports a translation of MeoCord's own plural texts that lacks a form its language needs, such as `few` in Russian, or that isn't a plural, `{}` included. See [Localisation](https://meocord.dev/docs/4.3/localisation).

A plural in a catalog with a form that isn't a text, as a JSON catalog may hold, reads as missing, so the next locale's catalog answers; translating it threw a `TypeError`.

`cooldownMessage` writes its wait with `formatDuration`, and its output is unchanged for every finite wait. A refusal whose wait is no finite number, as a custom `CooldownStore` may answer, now tells the caller "Slow down: try again later.", a new MeoCord text `meocord.cooldown.later` that an app's catalog translates, where they were shown a timestamp Discord couldn't display; `cooldownMessage` gives the same text where it wrote `NaNd NaNh`.
