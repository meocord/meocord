---
'meocord': patch
---

`shutdownTimeout` in `meocord.config.ts` is at most 2147478647 ms. Node fires a timer longer than 2147483647 ms at once, and the shard manager and `meocord start --dev` wait up to 5 seconds past `shutdownTimeout`, so a larger value made the bot or those two give up on shutdown at once. The config now refuses such a value as it loads, as it refuses a negative one. A bot started without the CLI, whose config is not checked, waits the default 10 seconds instead.

`@MeoCord({ themeForTimeoutMs })` names `Infinity` or `NaN` in its refusal, where it said `null`, and words it as `cooldownStoreTimeoutMs` does.
