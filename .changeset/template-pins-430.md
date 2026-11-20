---
'meocord': patch
---

A new app from `meocord create` starts on the latest stable releases of its dependencies and tools that are at least a day old: discord.js 14.28.1, dotenv 18.0.10, `@types/node` 26.6.6, eslint 10.15.0, typescript-eslint and `@typescript-eslint/parser` 8.73.0, prettier 3.10.1, eslint-plugin-import-x 4.18.1 and globals 17.14.0. TypeScript stays at 6.0.3, as typescript-eslint supports no later version, and vitest at 5.1.0, so an app runs its tests on Bun without Node.js. An existing app is unchanged.
