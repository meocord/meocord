---
'meocord': patch
---

A service whose `onReady` is still running when the bot stops, through `app.stop()` or a signal, now gets its `onShutdown` once that `onReady` finishes, so what it opened, such as a connection pool, is closed. Shutdown waits for it within the same `shutdownTimeout`, leaving the `onShutdown` hooks their reserve. An `onReady` still running then is named in a warning, and shutdown goes on without it. An `onReady` that calls `app.stop()` itself isn't waited for.

A testing module's `close()` during `init({ ready: true })` waits for the `onReady` hooks within its `shutdownTimeout` in the same way, warning about one that never settles rather than hanging, and an `onReady` that calls `close()` no longer waits for itself.
