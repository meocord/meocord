---
'meocord': patch
---

A start that fails, because a provider's factory failed or the login did, no longer leaves the app among those a Ctrl+C or SIGTERM shuts down. A signal later in the process shuts down only the apps that are running, and a retry of `start()` after a failed factory can still be stopped by one.
