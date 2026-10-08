---
'meocord': minor
---

`useMockFn(vi.fn)`, called once in a test setup file, makes every mock from `meocord/testing` with the test runner's own mock function. The runner then treats them as its own: Vitest's `clearMocks` and `mockReset` config, `vi.clearAllMocks()` and `vi.mocked(...)` reach them, and bun's matchers, which accept only bun's mocks, read them with `useMockFn(mock)`. jest takes `useMockFn(jest.fn)`. Without the call, mocks are meocord's own as before. Under jest and bun, whose `mockReset` drops a mock's starting behaviour, reset with meocord's `resetAllMocks()`, which puts it back. node:test keeps meocord's own mock function.

A new project's `vitest.setup.ts` calls `useMockFn(vi.fn)`. An existing project can add the same line to its setup file, before any mock is made. See https://meocord.dev/docs/4.2/mocks.
