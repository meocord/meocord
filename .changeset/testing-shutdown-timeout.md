---
'meocord': minor
---

`MeoCordTestingModule.create()` and `fromApp()` take `shutdownTimeout`, which mirrors the option of that name in `meocord.config.ts`. `close()` waits up to that long, 10 seconds unless set, for the `onShutdown` hooks and the cooldown store's operations still under way. Then it stops waiting and logs that it did, as the bot does, and still rejects with any hook that failed before then. A test whose fake store never answers, or whose `onShutdown` never settles, sets it short:

```ts
const module = MeoCordTestingModule.create({
  app: App,
  providers: [{ provide: CooldownStore, useValue: silent }],
  shutdownTimeout: 50,
}).compile()
```
