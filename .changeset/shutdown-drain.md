---
'meocord': patch
---

Shutdown now waits for the calls under way before the `onShutdown` hooks, in every bot, and stops taking events first:

- A handler that awaits `app.stop()`, as an owner-only shutdown command does, no longer holds the shutdown up until `shutdownTimeout`. It isn't waited for.
- No interaction, message, reaction or `@On`/`@Once` event starts a call once shutdown has begun, and an `@On`/`@Once` handler already running is waited for, as a dispatched call is. Before, a bot whose cooldown store has no `onShutdown` kept dispatching while its hooks ran.
- An `@On('error')` handler keeps receiving the client's errors until the client is destroyed.
- `shutdownTimeout` still bounds the whole shutdown. The calls are waited for no longer than the timeout less a reserve kept for the hooks: a quarter of it, at least 1 second and never more than half. A call still running then is named in a warning, and the hooks run in the time left.

A `stop()` while the bot starts now waits for the providers being made, at most `shutdownTimeout`, and makes nothing more after it, so no service is constructed once the bot has shut down. A factory still pending after `shutdownTimeout` is named in a warning. `MeoCordTestingModule.close()` during `init()` likewise waits for the providers `init()` is making, and closes them.
