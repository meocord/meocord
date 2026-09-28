---
'meocord': patch
---

Two JSDoc corrections. `@On` and `@Once` said an event handler runs with the app's global guards, interceptors and filters; its class's and its own run too, as they always have. `MeoCordTestingModule.fromApp`'s remarks now say plainly that `compile()` runs no factory and `init()` runs each one the module provides, so a factory the test replaces never runs, and one it keeps runs at `init()`.
