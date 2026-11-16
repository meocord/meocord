---
'meocord': patch
---

`useMockFn()` now always refuses once a mock has been made, whether or not that mock is still in use. Before, a mock made before it and then dropped made it throw until the garbage collector took the mock, and pass after, so the same setup could pass on one run and fail on the next. If a setup file throws `useMockFn() goes before any mock is made`, move the call ahead of anything that makes a mock, such as a helper that builds a mock interaction when it is imported: call `useMockFn()` first, in the test runner's setup file. See [Mocks](https://meocord.dev/docs/4.3/mocks).
