---
'meocord': patch
---

A testing module now makes the app's presenter in `init()`, after the providers, as the bot makes it, rather than in `compile()`. A presenter that injects a value a provider's async `useFactory` makes now works: `fromApp(App).compile().init()` rejected with inversify's `Unexpected asynchronous service`, though the bot started the same app. What the presenter injects is shut down by `close()`, as everything else the module made is; before, its `onShutdown` never ran.
