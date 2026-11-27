---
'meocord': patch
---

`meocord/eslint` now reads a bot's `tsconfig.json`, `tsconfig.test.json` and `tsconfig.eslint.json` from the folder of the bot's own `eslint.config.*`, wherever ESLint runs from. Linted from the root of a workspace, a bot whose config is `eslint.config.mjs`, `eslint.config.js` in a `"type": "module"` package, or `eslint.config.ts` under Bun's runtime got `TS5012` on every file. With any config, the import-cycle check missed cycles through the bot's path aliases from there, and was left out where `eslint-import-resolver-typescript` is installed in the bot's folder alone, as in a pnpm workspace. The `tsconfigRootDir: import.meta.dirname` entry the [ESLint guide](https://meocord.dev/docs/4.3/eslint#how-it-works) suggests for those configs can go; a `tsconfigRootDir` the app sets still wins.
