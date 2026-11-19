---
'meocord': patch
---

A provider whose factory settles after a stop stopped waiting for it now has its value shut down. A stop while the bot starts waits for the factory under way at most `shutdownTimeout`, then shuts down without it, as before. When that factory returns a value later, its own `onShutdown` now runs as it arrives, within `shutdownTimeout`, and `start()` rejects after that. A value with an `onReady` hook is the exception: that hook never ran, so by the rule for `onShutdown` at any stop, it gets none. Before, the value was left open: a connection or a timer it held kept a stopped bot's process running. What the value injects was shut down by the stop already, so its `onShutdown` may find that closed.

The testing module follows the bot. A `close()` while `init()` makes the providers waits for the factory under way at most `shutdownTimeout`, then warns, naming that factory, and shuts down without it; before, it waited for as long as the factory took, so a factory that never settles left `close()` pending. A value the factory returns later is shut down once it arrives and `close()` is done with the rest, within `shutdownTimeout`, with or without an `onReady` hook, as `close()` shuts down any value it made.

Once `close()` has begun, `init()` makes nothing after the factory under way: no other factory, no listed service, and no `onReady` hook runs. It still resolves. Before, it went on to make all of them, and `close()` shut them down afterwards. A test that calls `close()` while `init()` runs and then reads something `init()` would have made after that point finds it not made by `init()`, and not shut down by `close()`. A `get()` of a factory value it skipped throws, saying `close()` ended `init()` before it made that value.

After `close()`, `get()` returns what was shut down as before, without a word. When it makes an instance with an `onShutdown` only then, as a listed service an `init()` that `close()` ended did not make, it now warns once, naming it, since nothing shuts that instance down.
