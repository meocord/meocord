---
'meocord': patch
---

A stop while the bot starts now closes what the startup made. A Ctrl+C, a SIGTERM or `app.stop()` before the bot is online runs `onShutdown` for each class and provided value it has made whose `onReady`, and that of everything it depends on, has finished or doesn't exist, in reverse dependency order, as the testing module's `close()` already did. A connection pool your provider's factory opened is closed even when a later factory is still connecting or the login hasn't finished. A class whose `onReady` never ran still gets no `onShutdown`, and neither does anything that depends on it.

A start that fails, because a provider's factory or the login failed, shuts down what it made by the same rule, so a pool it opened no longer keeps the process alive after the failure and the process ends with its exit code. A value you gave with `useValue` stays open until the bot stops: `app.stop()`, a Ctrl+C or a SIGTERM closes it. A Ctrl+C or a SIGTERM that comes while a failed start shuts down waits for that shutdown to finish. A retry of `start()` makes the rest again, rather than reusing values that were shut down.

If an `onShutdown` of yours assumed `onReady` had run, give the class an `onReady`, or guard the hook. See [Lifecycle hooks](https://meocord.dev/docs/4.2/lifecycle-hooks).
