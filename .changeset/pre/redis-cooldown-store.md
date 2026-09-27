---
'meocord': minor
---

`RedisCooldownStore` in `meocord/common` keeps `@Cooldown` counts on Redis, so they survive a restart and are shared by every shard and process that uses the same server, which keeps `'user'` and `'global'` cooldowns exact under process sharding. MeoCord adds no Redis dependency: give `RedisCooldownStore.using` a function that runs a script with your client, and pass what it returns to `@MeoCord({ cooldownStore })`:

```typescript
import { RedisCooldownStore } from 'meocord/common'

// node-redis
cooldownStore: RedisCooldownStore.using((script, keys, args) => redis.eval(script, { keys, arguments: args }))
// ioredis
cooldownStore: RedisCooldownStore.using((script, keys, args) => redis.eval(script, keys.length, ...keys, ...args))
```

One Lua script checks and records each call as one step, timed by the server's `TIME`, with calls in the same millisecond kept apart and every key set to expire. Keys start with `meocord:cooldown:`, or `{ prefix }`; pass `{ evalsha }` to send the script by its SHA1, in full only when the server answers `NOSCRIPT`. It runs on Redis 5 and later, Valkey, KeyDB, Dragonfly and Upstash; Garnet runs Lua only in part, so check it with `testCooldownStore` first. See [Where calls are counted](https://meocord.dev/docs/4.1/cooldowns#where-calls-are-counted).
