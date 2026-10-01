---
'meocord': patch
---

The editor documentation of four APIs says more about what they do:

- `TestingModule.invoke` says that a guard's `GuardDeniedError`, a `UserError` and a `CooldownError` reject it, where `dispatch` resolves `{ ran, error }`, and its example shows both.
- `useTheme` names `themeFor`'s layers: the server's theme, then the user's, over the handler's `@UseTheme`.
- `createMock` says that a property its type declares as data is a mock function, so truthy, and shows passing the values the code reads.
- `testCooldownStore` says that its cases use whole-millisecond windows, so a store's handling of a fractional `windowMs`, such as `@Cooldown({ seconds: 1.0005 })` gives, is left to its own tests.
