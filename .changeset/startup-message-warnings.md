---
'meocord': patch
---

Two message-command setups that start today but don't do what they read as now warn at startup, once for the app or the handler:

- **A static `prefix: []`**, on the app or a handler, takes messages as they are, with no prefix, where a prefix function that returns `[]` starts no command. Write `''` for no prefix; a handler can also write `false` for no prefix and no mention. In the next major version (5.0), `[]` starts no command.
- **Two flags whose names differ only in case**, such as `{--v}` and `{--V}`, on a command that reads flags in any case: every `--v` or `--V` sets the first, and the second is never set. Rename one, or set `caseSensitive: true`. The next major version (5.0) refuses such a pattern.

What a message matches is unchanged.
