---
'meocord': patch
---

A class that injects `CooldownStore` gets the app's store, and nothing else is made of it.

- **The store's hooks run once.** A service that injected `CooldownStore` beside `@MeoCord({ cooldownStore })` made the token count as a class of its own, so the store's `onReady` and `onShutdown` each ran twice, and the first `onShutdown` came before the calls under way had finished. The token now stands for the app's store, so the service depends on the store, and the store's hooks run once, after the last call.
- **`MeoCordTestingModule` binds the app's store first, as the bot does.** A module made with `fromApp()`, or with `app`, whose app has a `cooldownStore`, failed to compile with "Ambiguous bindings found for service: CooldownStore" when one of its classes injected the token.
- **A cycle through the token is named.** A store that injects a class which injects `CooldownStore` is refused where it is declared, naming the classes, as any other cycle is, rather than failing with inversify's "Circular dependency" as the bot starts.
- **A `useClass` provider whose class injects `ExecutionContext`** is refused naming where it is declared and its token, as a factory provider is: `App: @MeoCord({ providers }): the provider for 'audit' uses Audit, which injects ExecutionContext, …`.
