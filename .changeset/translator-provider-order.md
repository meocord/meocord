---
'meocord': patch
---

An app without `i18n` can give its `Translator` through `@MeoCord({ providers })`. MeoCord refused that app, telling it to pass `i18n`, when the `Translator` provider came after a provider whose `useClass` or factory `inject` reached a class that injects `Translator`, and always when the app's cooldown store injects `Translator`. `MeoCordTestingModule` refused the same apps.

A `Translator` provider is now accepted wherever it sits in the list, and a cooldown store that injects `Translator` gets it. A class that injects `Translator` in an app with neither `i18n` nor a `Translator` provider is still refused, with the same message. Nothing to change in your app; a workaround that moved the `Translator` provider to the front of the list can stay.
