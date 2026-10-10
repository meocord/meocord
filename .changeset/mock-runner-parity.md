---
'meocord': patch
---

meocord's mocks now work with each test runner's own mock functions and matchers.

- Under `useMockFn(jest.fn)`, a method of a `createMock()` double that has no implementation set returns `undefined`, as jest's mocks do. It no longer overflows the stack. Nested methods, and methods whose name starts with `_`, stay mocks as before.
- jest's call matchers, such as `toHaveBeenCalled`, read a `createMock()` member as a mock, whether or not `useMockFn` is set. They took it for a jasmine spy and failed with `Cannot read properties of undefined (reading 'map')`.
  - To get this, a member named `calls` no longer makes `all` and `count` for itself: `x.calls.all` and `x.calls.count` read `undefined` until a test sets them.
  - Every other name under `calls`, such as `x.calls.foo`, is still a nested mock.
- Without `useMockFn`, Vitest's `toHaveResolved`, `toHaveResolvedWith`, `toHaveResolvedTimes`, `toHaveLastResolvedWith`, `toHaveNthResolvedWith`, `toHaveBeenCalledBefore` and `toHaveBeenCalledAfter` work on meocord's own mocks. `mock` gains `settledResults`, `invocationCallOrder` and `contexts` for them. The new fields stay out of `mock`'s keys, so a test comparing `mock` as a whole sees the same shape. Call order is counted across meocord's own mocks, so compare two of meocord's mocks, or two of the runner's, rather than one of each.
- `useMockFn(mock.fn)` under node:test gives meocord's refusal, which says to leave meocord's own mock function in place, with node's error as its `cause`, instead of node's internal TypeError.
