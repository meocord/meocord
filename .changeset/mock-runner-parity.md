---
'meocord': patch
---

meocord's mocks now work with each test runner's own mock functions and matchers.

- Under `useMockFn(jest.fn)`, a method of a `createMock()` double that has no implementation set returns `undefined`, as jest's mocks do. It no longer overflows the stack. Nested methods, and methods whose name starts with `_`, stay mocks as before.
- jest's call matchers, such as `toHaveBeenCalled`, read a `createMock()` member as a mock, whether or not `useMockFn` is set. They took it for a jasmine spy and failed with `Cannot read properties of undefined (reading 'map')`.
  - To get this, a nested member named `calls` no longer makes `all` and `count` for itself: `x.y.calls.all` and `x.y.calls.count` read `undefined` until a test sets them.
  - Every other name under it, such as `x.y.calls.foo`, is still a nested mock, and a `calls` member at the root, `x.calls.all`, is a mock as before.
- Without `useMockFn`, Vitest's `toHaveResolved`, `toHaveResolvedWith`, `toHaveResolvedTimes`, `toHaveLastResolvedWith`, `toHaveNthResolvedWith`, `toHaveBeenCalledBefore` and `toHaveBeenCalledAfter` work on meocord's own mocks. `mock` gains `settledResults`, `invocationCallOrder` and `contexts` for them. The new fields stay out of `mock`'s keys, so a test comparing `mock` as a whole sees the same shape. Call order is counted across meocord's own mocks, so compare two of meocord's mocks, or two of the runner's, rather than one of each.
- A meocord mock whose implementation returns a promise hands back a promise that settles the same way, not the same object. `expect(fn()).toBe(promise)` no longer holds; `toEqual`, `toHaveReturnedWith` and awaiting the result are unaffected. A property set on the given promise, such as a `cancel` method, isn't carried over.
- `useMockFn(mock.fn)` under node:test gives meocord's refusal, which says to leave meocord's own mock function in place, with node's error as its `cause`, instead of node's internal TypeError.
