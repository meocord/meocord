---
'meocord': patch
---

`meocord start --dev` restarts the bot through the bot's own stop, the one SIGINT and SIGTERM run, on every platform. On Windows, a restart used to end the bot outright, so its `onShutdown` hooks never ran on a save, and whatever they release or flush was left as it was. The dev runner now asks the bot to stop over the channel it already gives it, and the bot shuts down as it does on Ctrl+C, before the new build starts. A bot that doesn't exit within its `shutdownTimeout` and a short grace period is still killed, as before. Rebuild to pick this up.

When watch mode can't start, it stops a bot it had already started the same way, and exits once that bot has. Before, a bot that held on to its stop signal could outlive the CLI.

One save no longer restarts the bot twice. An editor's save can produce two builds of the same output, and a bot already running the latest output is now left alone. A change to `meocord.config.ts`, `tsconfig.json` or `.env` still always restarts it.
