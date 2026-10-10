---
'meocord': patch
---

A built bot now loads its packages after its config, and so after `.env`: a package that reads `process.env` as it loads, in a build without `bundleDependencies`, gets the values `.env` sets, as a self-contained build already gave it. A package kept out of the bundle loads where the code importing it runs: an ESM `import` is a dynamic `import()`, and a CommonJS `require` stays a `require` at its call site. A package listed in `externals` that a dependency requires inside a `try` therefore no longer stops the bot at startup when it is missing; an ESM import of one still does.

A self-contained build started on another platform stops with MeoCord's message naming both platforms, before any native addon loads, instead of the addon's own error. The message is now printed before the bot's logger is set up, as a plain `[ERROR] [MeoCord]` line.

A build without `bundleDependencies` removes the `node_modules`, `package.json` and `meocord.platform.json` a previous self-contained build left in `dist`, so it no longer runs packages from that stale copy. An external named as a file inside a package, such as `externals: ['lodash/fp.js']`, now packs its package.
