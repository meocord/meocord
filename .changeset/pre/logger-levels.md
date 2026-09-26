---
'meocord': minor
---

`Logger` prints from a level up, set by `logLevel` in `meocord.config.ts` (`'debug'`, `'log'`, `'warn'`, `'error'` or `'silent'`) or, for one run, by the `MEOCORD_LOG_LEVEL` environment variable, which wins. By default `[DEBUG]` lines show in development, where `NODE_ENV` is `development` as under `meocord start --dev`, and are hidden elsewhere, so a production log no longer carries the raw error and stack behind an explained startup failure such as a refused token. To see debug lines in production again, start with `MEOCORD_LOG_LEVEL=debug` or set `logLevel: 'debug'`. An unknown `MEOCORD_LOG_LEVEL` is reported once and ignored. The level is resolved once, on the first line logged, and a suppressed line costs no formatting.
