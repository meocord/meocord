---
'meocord': patch
---

`meocord start --dev` fixes:

- **Saving `.env` restarts the bot with the values it holds now.** The bot inherited the CLI's environment, which held `.env`'s values from when the session began. dotenv and Bun never replace a variable already set, so a changed token or setting kept its old value until the session was restarted, and a removed one stayed. The bot now inherits only what the shell set, and reads `.env` itself as it starts.
- **A save that doesn't compile leaves the bot running.** A build with errors emitted a bundle that throws them, and the bot restarted onto it. Now a build with errors emits nothing and restarts nothing, and the bot keeps running its last good build until the code compiles again.
- **An rsbuild plugin that throws as the build sets it up**, after an edit to `meocord.config.ts`, leaves the last build watching, as a hook that throws already did. Before, the session stopped rebuilding until it was restarted.
- **Ctrl+C while watch mode restarts the bot** joins that shutdown, so the bot's `onShutdown` hooks finish and the session exits 0. A second Ctrl+C still stops it at once.
