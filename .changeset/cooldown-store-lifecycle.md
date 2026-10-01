---
'meocord': patch
---

A class you bind with `@MeoCord({ cooldownStore })` now gets its `onReady` and `onShutdown` hooks, as a service does. Before, neither ran, so a store that opens a connection in `onReady` and closes it in `onShutdown` never connected and leaked its connection on every shutdown.

The order suits a store that connects:

- Its `onReady` runs before the services'. A call that comes while it runs waits for it, within `cooldownStoreTimeoutMs`. One that would wait longer meets your `cooldownStoreFailure` policy, as a store that doesn't answer does.
- Its `onShutdown` runs after the services'. The bot first stops taking new calls and lets the ones under way finish, along with every store operation they started, even an answer that came after its call stopped waiting. So the store closes after the last write it is asked for.

`MeoCordTestingModule` runs the store's hooks in the same order, in `init({ ready: true })` and `close()`, for the app's store or the `CooldownStore` a test provides in its place.
