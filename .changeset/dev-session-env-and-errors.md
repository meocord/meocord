---
'meocord': minor
---

`meocord start --dev` fixes:

- **A save that doesn't compile leaves the bot running.** A build with errors emitted a bundle that throws them, and the bot restarted onto it. Now a build with errors emits nothing and restarts nothing, and the bot keeps running its last good build until the code compiles again.
- **Ctrl+C while watch mode restarts the bot** joins that shutdown, so the bot's `onShutdown` hooks finish and the session exits 0. A second Ctrl+C still stops it at once.

A new app reads the same .env files on every runtime and however it is started, `meocord start` or `node dist/main.js` under pm2, systemd or Docker: `.env.<mode>.local`, `.env.local` (not under `test`), `.env.<mode>` and `.env`, a more specific file winning and the shell over all of them, as Bun reads them. An app made before this keeps `import 'dotenv/config'`, which reads `.env` alone under node, as 4.0 did. To read them all, replace that import in `meocord.config.ts` with:

```ts
import { config } from 'dotenv'

const mode = process.env.NODE_ENV || 'development'
config({
  path: [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env'],
  quiet: true,
})
```

On Bun, set `NODE_ENV=production` where you start a production bot yourself, as with `bun dist/main.js` under pm2, systemd or Docker. With `NODE_ENV` unset, Bun loads `.env.development` and `.env.development.local` before any code runs, and dotenv keeps what is already set, so their values win over `.env.production`. The bot now warns when that happens, naming the variables that hold a development value: "Bun loaded .env.development because NODE_ENV is unset, and this is a production build, so API_URL has its development value; set NODE_ENV=production, or start with `bun --no-env-file`." `meocord start --prod` sets `NODE_ENV=production` already.

`meocord build --prod` compiles `meocord.config.ts` in production mode, as it builds the bot, so `process.env.NODE_ENV` in the config reads `production` in a production build however the bot is started. It read `development`, the mode the config was always compiled in. So a config that branches on `NODE_ENV`, such as to register commands to a development guild, now takes its production branch in a production build: check what that branch does before you deploy, and rebuild to pick this up.
