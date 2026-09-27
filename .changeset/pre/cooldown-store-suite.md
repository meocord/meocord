---
'meocord': minor
---

`testCooldownStore` in `meocord/testing` checks a `CooldownStore` you write yourself, over Postgres, SQLite, MongoDB or anything else, against the behaviour `MemoryCooldownStore` defines. It registers its cases with your test framework's `describe`, `it` and `expect`, so it runs under Vitest or Jest:

```typescript
import { testCooldownStore } from 'meocord/testing'

testCooldownStore('PostgresCooldownStore', () => new PostgresCooldownStore(sql), { describe, it, expect })
```

It covers calls within a window, a sliding window, `retryAfterMs` counted from the oldest call still in the window, each key counted on its own, calls in the same millisecond kept distinct, and several concurrent calls at the limit where exactly one passes. It uses real time with short windows and takes a few seconds. The README's [Store recipes](https://meocord.dev/docs/4.1/recipe-cooldown-stores) show stores for Postgres, SQLite and MongoDB.
