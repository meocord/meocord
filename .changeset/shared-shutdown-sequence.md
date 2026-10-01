---
'meocord': patch
---

`shutdownTimeout` in `meocord.config.ts` is at most 2147483647 ms, the longest a timer keeps. Node fires a longer timer at once, so a larger value made shutdown give up on the `onShutdown` hooks immediately. The config now refuses it as it loads, as it refuses a negative one. The shard manager and `meocord start --dev`, which wait a little longer than `shutdownTimeout`, stay within that limit too.

`@MeoCord({ themeForTimeoutMs })` names `Infinity` or `NaN` in its refusal, where it said `null`, and words it as `cooldownStoreTimeoutMs` does.
