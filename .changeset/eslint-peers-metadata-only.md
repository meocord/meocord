---
'meocord': patch
---

`meocord/eslint`'s packages are no longer listed in `meocord`'s `peerDependencies`. Listing them there made npm and Yarn 1 install the lint toolchain (about 115 packages) in production for a bot that lints with `meocord/eslint`, as every bot from `meocord create` does: `npm ci --omit=dev` installed it, and `npm audit --omit=dev` reported its advisories. They stay in `peerDependenciesMeta` as optional peers of any version, which pnpm, Bun and Yarn 2+ read as before. For `npm ci --omit=dev` to leave the toolchain out, update the bot's lockfile to this version with `npm install` or `npm update meocord`. Bun's production installs (`bun install --production`) still include the toolchain: Bun keeps an optional peer in a production install when the bot has it as a devDependency. `meocord/eslint` works as before. See [ESLint](https://meocord.dev/docs/4.3/eslint#adopting-it-by-hand).
