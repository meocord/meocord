---
'meocord': minor
---

`ShardedCooldownStore` in `meocord/common` makes `'user'` and `'global'` cooldowns exact under process sharding without a database. Each shard asks the shard manager, which counts every shard's calls in its memory over the IPC the shards already use:

```typescript
import { ShardedCooldownStore } from 'meocord/common'

@MeoCord({ controllers: [...], clientOptions: {...}, cooldownStore: ShardedCooldownStore })
export default class App {}
```

Counts are kept while the manager runs, so a shard that restarts keeps them, but they start again when the whole bot restarts. For counts that outlive a restart, or a bot on several hosts, use `RedisCooldownStore`. If the manager does not answer within a second, a shard counts the call itself and warns once. The startup warning about per-shard cooldowns stays silent with this store, and now names both shared stores. See [Where calls are counted](https://meocord.dev/docs/4.1/cooldowns#where-calls-are-counted).
