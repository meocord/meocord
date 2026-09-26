---
'meocord': minor
---

`factoryProvider` in `meocord/common` types a factory provider: each `useFactory` parameter is what the token in the same place of `inject` provides (a class's instance, a `createToken` token's type, or `unknown` for a string or plain symbol), and the factory must return what `provide` stands for. A parameter `inject` does not supply, one of the wrong type, or a wrong return fails to compile. It returns the provider unchanged, for `@MeoCord({ providers })` and the testing module.

```typescript
factoryProvider({ provide: DATABASE, inject: [Config, PORT], useFactory: (config, port) => new Pool(config.url, port) })
```

A plain `{ provide, useFactory, inject }` object works as before. TypeScript cannot type its factory from `inject` inside a list, which is why this is a function.
