---
'meocord': minor
---

MeoCord's CommonJS build bundles its ES-module-only dependencies, `inversify` (with its `@inversifyjs/*` packages) and `chalk`, so `require('meocord/...')` loads nothing that ships only as an ES module. jest, which runs tests as CommonJS, now loads `meocord/testing` without Node's VM modules: drop `NODE_OPTIONS=--experimental-vm-modules` from a jest setup that added it for MeoCord. With the flag left in, jest runs as before. The ES module build imports both packages from `node_modules` as before. A process that loads both builds runs two copies of `inversify` and of `chalk`: the one bundled into the CommonJS build and the one in `node_modules` that the ES module build imports. The two builds' `Logger` writes the same output under each colour setting. `dist/cjs` grows from 1386 KB to 1679 KB, and THIRD_PARTY_NOTICES.md carries the bundled packages' licenses. See https://meocord.dev/docs/4.3/testing.
