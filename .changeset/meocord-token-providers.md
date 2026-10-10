---
'meocord': patch
---

`@MeoCord({ providers })` now warns about a provider for `ThemeCache` or `ExecutionContext`, tokens MeoCord binds itself: a `ThemeCache` provider silently replaced the app's theme cache. The bot still starts; the next major version (5.0) refuses such a provider. Remove it. A `Translator` provider without `i18n` stays supported, and `MeoCordTestingModule`'s providers are unchanged.
