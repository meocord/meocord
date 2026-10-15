---
'meocord': patch
---

A testing module checks the app's providers for MeoCord's own tokens as the bot does:

- **`overrideProvider(ShardContext)` and `overrideProvider(HandlerRegistry)`** replace MeoCord's binding with the double, in both modes, so a test can stub cross-shard calls. Before, the double was bound beside MeoCord's, and the first call failed with inversify's "Ambiguous bindings".
- **An app whose `@MeoCord({ providers })` provides `HandlerRegistry` or `ShardContext`** is refused by `compile()` with the bot's message, in both modes. Before, it compiled and failed at its first call.
- **An app that provides `Client`, `CooldownStore`, or `Translator` while it gives `i18n`** is refused by `compile()` under `useStrictMocks()`, as the bot refuses it at startup. In default mode it still compiles, with a warning once.
- **An app that provides `ThemeCache` or `ExecutionContext`** gets the bot's warning that the next major version (5.0) refuses it.

A test's own `providers` and overrides may still provide `Client` and `CooldownStore`.
