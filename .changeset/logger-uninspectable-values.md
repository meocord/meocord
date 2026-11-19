---
'meocord': patch
---

`Logger` no longer throws when it is given a value whose inspection throws, such as an object whose own `[util.inspect.custom]` throws. That value prints as `[value could not be inspected: <reason>]`, and the rest of the line prints as before. Such a value, thrown by your own code, could end a running bot: an observer's `onStart` rejecting with it or its `onSettled` throwing it left a rejection nothing handled, so the process exited 1, and an `onShutdown` hook throwing it kept a stop by signal from destroying the client and exiting cleanly.

A bot also no longer depends on its reports to keep going in those places:

- An observer whose failure can't be reported, as a class whose `name` getter throws, is reported in its place, and the other observers still run.
- A stop by signal destroys the client and exits even when something in the stop fails: with 0 when an `onShutdown` hook failed, as before, and with 1 when the stop itself failed, as when reporting a hook's failure throws.
- A cooldown store's failure is logged as `failed`, without the reason, when what it failed with can't be read as text, and the policy you set still decides the call.

Nothing changes for a value that prints today.
