---
'meocord': patch
---

Two fixes to `meocord start --dev`:

- Saving `meocord.config.ts`, `tsconfig.json` or a `.env` file while a reload runs is no longer dropped or doubled. A save during a rebuild waited for another save before it took effect, and a second save while the config was compiling started a second reload beside the first. Reloads now run one at a time, each taking every file changed since the last one began.
- With `bundleDependencies` on, `start --dev` no longer runs the packages a previous `meocord build` packed into `dist/node_modules`. A watch build packs nothing, so it now removes those copies, as a build without `bundleDependencies` does, and the bot loads the project's own packages.
