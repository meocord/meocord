---
'meocord': patch
---

Three fixes to how `@MeoCord({ providers })` and a testing module wire classes and providers:

- A provider that would receive `ExecutionContext` is refused as the app is created: a factory provider whose `inject` lists it, or a `useClass` provider whose class injects it. The message names where it is declared and its token, such as `App: @MeoCord({ providers }): the provider for 'audit' uses Audit, which injects ExecutionContext, …`. Such a provider is made once, so the context it received was an empty one, bound for the whole app, and every later call shared it.
- A class whose own source contains the text `[native code]`, such as one that inspects functions, is injected like any other class of the app. It was taken for a built-in constructor and never bound, so the app stopped at startup with `No bindings found for service`.
- Providers or classes that inject each other in a cycle are refused as the app is created, naming the cycle, such as `'a' → 'b' → 'a'`. The app failed when the first of them was made, with `Circular dependency found: (No dependency trace)`.
