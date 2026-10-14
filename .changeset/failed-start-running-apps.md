---
'meocord': patch
---

A start that fails, because a provider's factory failed or the login did, no longer leaves the app among those a Ctrl+C or SIGTERM shuts down once it holds nothing open, so a later signal doesn't log `Shutting down bot...` for a bot that never started. An app that still holds a value you gave with `useValue` that a stop would shut down, one with an `onShutdown` and no `onReady`, stays among them until a stop closes it, and a retry of `start()` after a failed factory can still be stopped by a signal.
