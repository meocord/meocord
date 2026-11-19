---
'meocord': patch
---

The declarations of `TestingModule` and `TestingModuleBuilder`, from `meocord/testing`, no longer name the internal types MeoCord makes a module from, such as `ProviderMap` and `LifecycleUnit`. Each constructor parameter is declared `unknown`, so your editor's hover shows none of them. Nothing stops compiling: code that calls `new` on either class, extends it or passes it as a constructor type compiles as before. The constructors stay undocumented: make a module with `MeoCordTestingModule.create(…).compile()` or `MeoCordTestingModule.fromApp(…).compile()`. See https://meocord.dev/docs/4.3/testing.
