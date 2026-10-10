---
'meocord': patch
---

Every service the app makes now gets its lifecycle hooks once, in the bot and in `MeoCordTestingModule`:

- A service that only a guard, interceptor, filter, pipe or the presenter injects is made as the bot comes online, and its `onReady` and `onShutdown` run, as `@Service` documents. Before, it never got its hooks, and it was made anew for every call that reached its stage. It is now the one shared instance `@Service` promises. A constructor that throws in such a service is reported as the bot comes online instead of failing each call. A class that injects the call's `ExecutionContext` is still made for each call, without hooks. If you worked around the missing hooks by calling an init method from the guard, or by listing the service in `services`, you can remove that.
- One instance that two tokens reach, such as a factory alias of a service or one value provided twice, runs its `onReady` and `onShutdown` once instead of twice.
