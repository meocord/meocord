---
'meocord': minor
---

`MeoCordTestingModule.create()` and `fromApp()` take `shutdownTimeout`, which mirrors the option of that name in `meocord.config.ts`: from 0 to 2147478647 ms, refused otherwise, with the message `meocord.config.ts` gets for it. `close()` runs the bot's own shutdown sequence, so before the cooldown store shuts down, the calls `invoke`, `dispatch` and `emit` have under way finish. It waits up to `shutdownTimeout`, 10 seconds unless set, for the calls, the store's operations and the `onShutdown` hooks. Then it stops waiting and logs that it did, as the bot does, and still rejects with any hook that failed before then. A test whose fake store never answers, or whose `onShutdown` never settles, sets it short:

```ts
const module = MeoCordTestingModule.create({
  app: App,
  providers: [{ provide: CooldownStore, useValue: silent }],
  shutdownTimeout: 50,
}).compile()
```
