---
'meocord': patch
---

A stopped app no longer asks its theme resolver, and a stop no longer leaves a slow `onReady` warning behind.

- Once a bot's stop or a testing module's `close()` has ended its shutdown, a theme lookup asks no `themeFor` resolver: an answer outside any call and a testing module's `dispatch()` after `close()` answer in the handler's theme, or the app's outside a call, and nothing is logged for the lookup. The `onShutdown` hooks have closed what a resolver uses by then, and in a test its timeout warning landed in a later test. A start that fails and is retried looks themes up as before.
- A stop that gives up on an `onReady` still running ends that hook's 10-second slow warning. It used to fire after the stop had resolved, and its timer kept a process with nothing else left alive. A stop that waits the hook out still warns.

See https://meocord.dev/docs/4.3/lifecycle-hooks.
