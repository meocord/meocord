---
'meocord': patch
---

`overrideGuard`, `overrideInterceptor` and `overrideFilter` replace a stage that is also a provider. A guard, interceptor or filter listed in `providers`, the app's or the testing module's, made every call fail with `Ambiguous bindings found for service` once it was overridden. Now the stub stands in for it, and wins over an `overrideProvider` of the same class.

`compile()` also checks each stub for its stage's method, `canActivate`, `intercept` or `catch`, on the stub or its prototype. Under `useStrictMocks()`, a stub without it is refused with `overrideGuard(G).useValue(…) has no canActivate method.` By default, `compile()` warns with the same words and builds the module, so a test that never reaches the stage passes as before. See [Testing](https://meocord.dev/docs/4.2/testing).
