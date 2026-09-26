---
'meocord': patch
---

`logLevel` in `meocord.config.ts` applies to the built bot only. The CLI and tests read it from whatever `dist/meocord.config.mjs` a previous build left, so `meocord build` printed its progress on the first build and nothing on the next, and a test's log lines depended on whether the app had been built. Both now print by `MEOCORD_LOG_LEVEL` and the default; set `MEOCORD_LOG_LEVEL` to quiet them.
