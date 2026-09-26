---
'meocord': minor
---

A testing module runs the lifecycle hooks. `await module.init({ ready: true })` runs every `onReady` once, in the order the bot runs them: each class after the classes and providers it injects, the observers last. `await module.close()` runs, in reverse, the `onShutdown` hooks of everything the module has constructed, whether or not it was readied, so a test can close a provider it opened, such as a connection pool a factory made in `init()`, instead of leaking it; nothing is constructed just to be shut down. `onReady` receives a client from `createMockClient` and `{ primary: true }`, or those passed as `init({ ready: { client, primary } })`. Every hook runs even when one throws; `init` or `close` then rejects with that error, or an `AggregateError` naming each hook that threw. `init()` without `ready` runs no hook, as before.
