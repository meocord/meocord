---
'meocord': minor
---

`MeoCordTestingModule.create()` and `fromApp()` take `shutdownTimeout`, which mirrors the option of that name in `meocord.config.ts`. `close()` waits up to that long, 10 seconds unless set, for the cooldown store's operations still under way, then shuts the store down anyway, as the bot does. A test whose fake store never answers sets it short:

```ts
const module = MeoCordTestingModule.create({
  app: App,
  providers: [{ provide: CooldownStore, useValue: silent }],
  shutdownTimeout: 50,
}).compile()
```
