---
'meocord': patch
---

A testing module's `close()` called from a call it is running, such as a command handler that awaits `module.close()`, no longer waits for that call. Before, in a module whose cooldown store has an `onShutdown`, the close drained the calls under way, the handler awaiting it among them, so it waited out `shutdownTimeout` less the hooks' reserve, warned `Calls still running after … ms`, and only then ran the `onShutdown` hooks and resolved. Now it leaves that call out, as the bot's `app.stop()` does for a handler that awaits it: the close goes on at once and the other calls still drain. See https://meocord.dev/docs/4.3/testing.
