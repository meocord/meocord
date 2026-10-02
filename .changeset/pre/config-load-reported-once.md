---
'meocord': patch
---

A compiled config that fails to load is reported once, with its reason and what to do: "MeoCord config at … failed to load: <reason>. Fix meocord.config.ts, then run `meocord build`.", or, when the config needs a package that isn't installed, one that says to install it. A built bot printed a separate "[MeoCord] Failed to load …" line before that one, and `meocord start --prod` printed it a third time. `meocord start --prod` without `--build` now stops with that message, rather than check `meocord.config.ts` in its place, which could stop on a missing token without naming the broken config the bot would run.
