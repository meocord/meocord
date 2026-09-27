---
'meocord': patch
---

`Logger` reads `appName` from the config only in the built bot. Elsewhere it read `dist/meocord.config.mjs` left by the last build, so the CLI prefixed its lines with a previous build's name, and a test that logged loaded `.env` through that file's `import 'dotenv/config'`, but only once the app had been built. Tests now never load `.env` on their own; see [Running tests](https://meocord.dev/docs/4.1/testing#running-tests) to load it in `vitest.setup.ts`.
