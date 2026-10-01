---
'meocord': patch
---

The editor documentation of three APIs says more about what they do:

- `TestingModule.invoke` says that a guard's `GuardDeniedError`, a `UserError` and a `CooldownError` reject it, where `dispatch` resolves `{ ran, error }`, and its example shows both.
- `useTheme` names `themeFor`'s layers: the server's theme, then the user's, over the handler's `@UseTheme`.
- `createMock` says that a property its type declares as data is a mock function, so truthy, and shows passing the values the code reads.
