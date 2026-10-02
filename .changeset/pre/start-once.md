---
'meocord': patch
---

`start()` sets the bot up once. Calling it again after a failed login used to attach every event handler a second time, so each command, message and reaction ran twice, `onReady` ran twice, and an app with a presenter could no longer answer the built-in `help`. Now a retry logs in again with the handlers it already has. Two calls at once share one start, and a call once the bot is online does nothing.

After a retry logs in, the client works as a fresh one would: `isReady()` reports it, shutdown closes the gateway, and configured cache sweepers run again. A failed login makes discord.js destroy its client, so MeoCord undoes that before trying again.

A retry that logs in now clears the exit code the failed login set to `0`, which Bun keeps, rather than to `undefined`, which Bun ignores. It also gives code that runs outside a handler, such as a scheduled job calling `useTheme()`, the app's theme again, which the failed login had dropped.

Retrying `start()` after a failed login is deprecated; in the next major version (5.0) it rejects. Use `MeoCordFactory.create` to make a new app instead. It logs that warning once. A retry after a provider's factory failed stays supported, with no warning. See [the upgrade guide](https://meocord.dev/docs/4.1/migrating#retrying-start-after-a-failed-login-is-deprecated).
