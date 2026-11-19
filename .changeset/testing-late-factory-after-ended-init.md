---
'meocord': patch
---

After a testing module's `close()` ends an `init()` that was still waiting for a factory, a `dispatch()`, `invoke()`, `emit()` or `get()` that needs the value of a factory `init()` didn't reach no longer runs that factory. Before, a sync factory made its value there, from values `close()` had already shut down, and nothing shut it down; an async one ran too, then the call failed with inversify's "Unexpected asynchronous service". Now the call rejects, and `get()` throws, with an error naming the token: "close() ended init() before it made 'TOKEN'; its factory doesn't run after close()". A call that makes, after any `close()`, a service or controller with an `onShutdown` now warns, naming it, as `get()` already did, since nothing shuts it down. See https://meocord.dev/docs/4.3/testing.
