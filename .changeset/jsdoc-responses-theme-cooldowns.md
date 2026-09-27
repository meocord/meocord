---
'meocord': patch
---

The JSDoc of `respond`, the theme API (`useTheme`, `bindTheme`, `UseTheme`, `ThemeCache`, `Theme` and the theme types), the errors a user is shown (`UserError`, `CooldownError`, `CooldownStoreError`), the presenter types, the translator and the cooldown stores now follows the JSDoc standard, for the hover in your editor and the API reference. Every example among them compiles against the published types: those that read an `interaction`, a database or an app they did not declare are now complete, and `MemoryCooldownStore`, `Theme`, `cooldownMessage` and `cooldownStoreMessage` gain one.
