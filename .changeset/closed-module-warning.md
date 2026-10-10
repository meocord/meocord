---
'meocord': patch
---

A testing module asked to `dispatch`, `invoke` or `emit` after `close()` now warns once that it is closed and its services have shut down. It still runs the call, as before. A misplaced `close()`, such as one in `afterEach` that runs before a test's last call, shows instead of passing quietly on shut-down state. See [Testing](https://meocord.dev/docs/4.2/testing).
