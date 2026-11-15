---
'meocord': minor
---

Under Bun, what the runtime prints itself names your source, as under Node: `console.error(error)` and any other inspection of an error, an uncaught error, and a rejection nothing handles. `sourceMappedStacks` mapped only `error.stack`, so a crash, the trace most worth reading, showed positions in `dist/main.js`.

When the bundle maps its stacks (`sourceMappedStacks` is not `false` and the build wrote its source map), a bot running on Bun gets:

- an inspection hook on `Error.prototype` (`Symbol.for('nodejs.util.inspect.custom')`), which inspects an error with its mapped stack and keeps its own properties, such as a `DiscordAPIError`'s `code`, and its `cause`;
- an `uncaughtException` and an `unhandledRejection` listener on `process`, which print the error with its mapped stack and end the process as Bun would: code 1 for an uncaught error, and for a rejection as Bun's `--unhandled-rejections` mode decides. Without the flag a rejection ends the process; under `=throw` it is raised as an uncaught error, which your own `uncaughtException` listener gets, or which ends the process when there is none.

What Bun prints changes with it. `console.error(error)` and a crash print the error in Node's inspection format, `Error: message` followed by `at` lines naming `src/` files and any own properties in braces, where Bun printed its own layout: the source line excerpt above the error and, for a crash, the `Bun v…` line below it are gone. An error whose `stack` is no string of its own, such as a `DOMException` or one with a `stack` getter, is printed by Bun's own formatter, so a crash still shows its name and message. Under `--unhandled-rejections=warn`, Bun prints its own warning for a rejection, which keeps the bundle's positions. Set `sourceMappedStacks: false` to keep Bun's own output.

`process.listenerCount()` for each of the two events is one higher. An application that listens for either event itself, before or after MeoCord, keeps the error and the exit, also with a listener that removes itself as it runs, as `process.once` adds one: MeoCord's listener does nothing while another listener is there. The exception is a listener that runs ahead of MeoCord's and removes itself, as one added after MeoCord's with `process.prependOnceListener` does: it is gone by the time MeoCord's listener runs, so MeoCord also reports the error and exits 1. Under Node nothing changes. See [Configuration](https://meocord.dev/docs/4.3/configuration).
