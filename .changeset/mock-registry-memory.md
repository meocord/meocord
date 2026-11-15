---
'meocord': patch
---

The mocks `meocord/testing` makes with its own mock function no longer stay in memory until a test yields to the event loop. A test that made thousands of mock interactions in one loop, awaiting only promises, kept about 290 KB for each, and could run out of heap. `clearAllMocks()` and `resetAllMocks()` now reach each of meocord's own mocks the next time it is used: called, read through `fn.mock` or a matcher, or set. One difference: an array a test read before the clear, as in `const calls = fn.mock.calls`, keeps its entries until the mock is next used, then empties in place. Reading `fn.mock.calls` again, or a matcher, sees the cleared state at once. With `useMockFn(vi.fn)`, Vitest holds each of its mocks until the test yields, so a test making thousands of them yields between batches with `await new Promise(resolve => setTimeout(resolve, 0))`. See [Mocks](https://meocord.dev/docs/4.3/mocks).
