---
'meocord': patch
---

`meocord/testing` no longer loads `cli-table3`. A test file that imports the testing toolkit loads only what testing needs, so a test environment that bundles or stubs its dependencies, such as an in-browser sandbox, works without `cli-table3`, which only the startup table of registered commands uses.
