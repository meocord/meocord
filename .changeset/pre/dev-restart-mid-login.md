---
'meocord': patch
---

`meocord start --dev` restarts the bot once per change, and the new bot always starts. The watcher took the tsconfig copy MeoCord writes for each build for a change of its own and rebuilt right after the first build, restarting the bot while it was still logging in. A stop that lands during login also left the old process running: discord.js's `destroy()` does not settle while the gateway waits for READY, so the bot came online after "Shutting down bot..." and the replacement never started.

- A stop during login now ends the start at once, and ends with "Bot has shut down" as any other stop does: no `onReady` hook runs, `start()` rejects with an error `isExplainedError()` recognises, and the process exits 0. The client is closed once its login completes. This also fixes a Ctrl+C during login in production, which did nothing until a second one forced exit 1.
- Edits to `tsconfig.json` now rebuild and restart the bot under `start --dev`, as edits to `meocord.config.ts` do. A changed `meocord.config.ts` is compiled again before the rebuild, and one that does not compile, such as a file saved mid-edit, is reported and leaves the running bot in place instead of ending the session.
- If an application still has not exited after its `shutdownTimeout` and a short grace period, `start --dev` kills it with a warning and starts the new build.
