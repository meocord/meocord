---
'meocord': patch
---

A testing module asked to `dispatch`, `invoke` or `emit` after `close()` now warns once that it is closed and its services are shut down, or shutting down, including while `close()` is still running. It still runs the call, as before. A misplaced `close()`, such as one in `afterEach` that runs before a test's last call, shows instead of passing quietly on that state. See [Testing](https://meocord.dev/docs/4.2/testing).
