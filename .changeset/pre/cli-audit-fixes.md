---
'meocord': patch
---

CLI and build fixes:

- **Every imported file lands in `dist/assets` under its own name.** A pdf, txt, webmanifest or wasm import was written to `dist/static/assets` with a content hash, unlike images, fonts and media. Its import gives that path as before, so nothing in your code changes; rebuild to pick it up. Two imported files of one name in different folders stop the build with Rspack's conflict error, naming the file.
- **`meocord start --dev` runs the bot on the development .env files whatever `NODE_ENV` your shell holds**, as its development build's config reads them: it watches them, and starts the bot with `NODE_ENV=development`. With `NODE_ENV=production` in the shell, it watched the production files, and a bot on Bun read the production values.
- **A production bot on Bun warns about another mode's .env values for any `NODE_ENV` but `production`.** Bun reads the development files for every `NODE_ENV` except `production` and `test`, so a bot started with `NODE_ENV=staging` ran on development values without the warning an unset `NODE_ENV` gets.
- **`meocord create` warns on Node 22.0 to 22.12**, below the `>=22.13` the package requires. It compared the major version alone.
- **The CLI finds an installed package in the filesystem root's `node_modules`**, as with a project directly under `/` in a container.
