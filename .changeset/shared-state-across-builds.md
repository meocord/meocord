---
'meocord': patch
---

A process that loads meocord both as an ES module and through `require()`, such as an ES module bot with a CommonJS helper, a jest CommonJS `setupFiles` beside ES module specs, or `node --require ./setup.cjs`, now behaves as one:

- `UserError`, `GuardDeniedError`, `ValidationError` and meocord's other errors from either build are answered as what they are, and `instanceof` holds across the two. An app's own subclass still matches only its own instances.
- A handler's `@UseTheme` theme, the app's translator for meocord's own texts, and its presenter apply whichever build answers.
- `useStrictMocks()` and `useMockFn()` called in a setup file in one format apply to mocks made in the other, and the two never give two mocks one id.

The two builds share this state only within one installed version. Mock ids keep counting across `vi.resetModules()` and `jest.resetModules()`, where they restarted.
