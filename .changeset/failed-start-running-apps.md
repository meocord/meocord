---
'meocord': patch
---

A start that fails, because a provider's factory failed or the login did, no longer leaves the app among those a Ctrl+C or SIGTERM shuts down once it holds nothing open, so a later signal doesn't log `Shutting down bot...` for a bot that never started. An app that still holds a value you gave with `useValue`, one with an `onShutdown`, stays until a stop closes that value, and a retry of `start()` after a failed factory can still be stopped by a signal.
