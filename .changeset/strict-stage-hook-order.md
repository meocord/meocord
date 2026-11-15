---
'meocord': patch
---

Under `useStrictMocks()`, `MeoCordTestingModule`'s `init({ ready: true })` and `close()` run the lifecycle hooks of a class that only a guard, an interceptor, a pipe, a filter or the presenter injects in the bot's order: its `onReady` after the controllers' and observers', and its `onShutdown` before theirs. Without strict mocks, the order is unchanged. The one change is a warning, once per run, naming the first class whose hooks would run in another order; it is logged only when such a class has the hook that is about to run. MeoCord 5.0 uses the bot's order without the call. With `@MeoCord({ waitForReady: true })`, a strict testing module's calls wait for the same hooks as the bot's. See [Mocks](https://meocord.dev/docs/4.3/mocks).
