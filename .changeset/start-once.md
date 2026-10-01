---
'meocord': patch
---

`start()` sets the bot up once. Calling it again after a failed login used to attach every event handler a second time, so each command, message and reaction ran twice, `onReady` ran twice, and an app with a presenter could no longer answer the built-in `help`. Now a retry logs in again with the handlers it already has. Two calls at once share one start, and a call once the bot is online does nothing.

After a retry logs in, the client works as a fresh one would: `isReady()` reports it, shutdown closes the gateway, and configured cache sweepers run again. A failed login makes discord.js destroy its client, so MeoCord undoes that before trying again.

A retry that logs in now clears the exit code the failed login set to `0`, which Bun keeps, rather than to `undefined`, which Bun ignores.

Calling `start()` again after a failed login is deprecated, and logs a warning once. In 5.0 it rejects. To retry, create the app again with `MeoCordFactory.create`.
