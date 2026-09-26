---
'meocord': patch
---

`CooldownStoreFailure`, the type of `@MeoCord({ cooldownStoreFailure })`, is exported from `meocord/interface`. `@MeoCord`'s declarations referred to it without any entry exporting it, so a consumer declaring a value of that type, or emitting declarations for an app that wraps `@MeoCord`'s options, had no name to import and could hit TS2742.
