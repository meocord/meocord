---
'meocord': patch
---

The examples your editor shows on hover for these members now compile as written: `TestingModule`'s `init`, `close`, `themeCache`, `invoke`, `dispatch` and `emit`; `TestingModuleBuilder`'s `overrideProvider`, `overrideGuard`, `overrideInterceptor`, `overrideFilter`, `overrideTheme` and `overrideThemeFor`; `HandlerRegistry.messageHelp`; `ExecutionContext.getHandlerParams`; `RedisCooldownStore.using`; and the `messages.handlers` option. Each declares the controllers, guards and services it uses instead of naming ones it never shows, and `messages.handlers`' gives `@MeoCord` the `clientOptions` it requires. `RedisCooldownStore.using` shows node-redis and ioredis as two examples, so either can be copied alone, and `TestingModule.close`'s shows a factory's value closed after the class that injects it. Nothing changes at runtime.
