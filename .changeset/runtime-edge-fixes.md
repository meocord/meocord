---
'meocord': patch
---

Fixes at the edges of shutdown, sharding, themes and the handler registry:

- With `sharding.development`, a Ctrl+C while `meocord start --dev` restarts the bot joins that stop, as it does in one process; it no longer kills every shard and exits 1.
- The shard manager's `stop()` sets `process.exitCode` to 1 when it has to kill a shard, unless another code is set, as a bot in one process does when its client fails to close.
- A shard's `stop()`, and its report of a failed start, wait at most a second for a manager that is gone, where Bun would otherwise wait for ever.
- An `onShutdown` hook does not run for a class whose `onReady` was still running when shutdown began, even when it finishes while the calls under way are waited for, as the `OnShutdown` docs say.
- `useTheme()` outside a call reads the app's theme until the app has shut down, so `onShutdown` hooks and the calls shutdown waits for read it too.
- A `themeFor` lookup that `ThemeCache` forgot while it was in flight logs nothing when it fails.
- `HandlerRegistry` gives an entry point command, whose builder returns a REST body, its `command` and `description`. A handler without a builder of its own gets the JSON of its own kind of command, by type and name as Discord tells commands apart, and a context menu's by its whole name. A message command's `scope` is narrowed to `'guild'` by a `member`, `role` or `channel` param or flag, as help shows it.
- A context menu whose name has a space and whose builder cannot be serialised is no longer reported as one no builder registers.
- A localization under a key that is not a Discord locale is reported once, as an unknown locale, and its value is not checked.
