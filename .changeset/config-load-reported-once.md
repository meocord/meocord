---
'meocord': patch
---

A built bot whose `meocord.config.mjs` fails to load reports it once: "MeoCord config at … failed to load: <reason>. Fix meocord.config.ts, then run `meocord build`." It printed a separate "[MeoCord] Failed to load …" line before that one, and under `meocord start --prod` the CLI printed it a third time.
